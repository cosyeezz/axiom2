import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/storage.js";
import { ModelService } from "../src/server/model-service.js";
import { closeModelNetworks } from "../src/server/model-network.js";
import { Agents } from "../src/server/agents.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";
import { TaskScheduler } from "../src/server/tasks/scheduler.js";
import { TaskDelivery } from "../src/server/tasks/delivery.js";
import type { Workspace, Session } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    assert.ok(Date.now() < deadline, message);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test("real first binding denial retains the original delegation; explicit retry sends one prompt, not empty resume", { timeout: 45_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-initial-retry-")), pi = join(root, "pi"), cwd = join(root, "project");
  mkdirSync(pi); mkdirSync(cwd);
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = pi;
  const requests: any[] = [];
  const http = createServer(async (request, response) => {
    let raw = ""; for await (const part of request) raw += part;
    requests.push(JSON.parse(raw));
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.end(`data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Original delegation completed." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const auth = (key: string) => writeFileSync(join(pi, "auth.json"), JSON.stringify({ fixture: { type: "api_key", key } }));
  writeFileSync(join(pi, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", baseUrl: `http://127.0.0.1:${(http.address() as any).port}/v1`, models: [{ id: "fixture", contextWindow: 32000, maxTokens: 256 }] } } }));
  auth("before-preparation");
  const store = new Store(root), models = new ModelService(root), agents = new Agents(store, models, () => {});
  const records = new TaskRecords(store), delivery = new TaskDelivery(agents, records), scheduler = new TaskScheduler(agents, records, delivery);
  delivery.pause();
  let borrowed = 0;
  models.prepareAuth = async () => assert.fail("resource admission must not preflight model authentication");
  const acquire = agents.pool.acquire.bind(agents.pool);
  agents.pool.acquire = async request => {
    const lease = await acquire(request); borrowed++;
    if (borrowed === 1) {
      const child = await lease.ensureReady();
      child.prependListener("message", (event: any) => {
        if (event.type === "binding_ready") writeFileSync(lease.environment.modelsFile, "corrupted internal snapshot");
      });
    }
    return lease;
  };
  try {
    const workspace = store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: cwd, authorized: true } }) as Workspace;
    const parent = store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: parent.id };
    const selection = { provider: "fixture", id: "fixture", thinking: "off" as const };
    const taskId = records.create(scope, "anchor", "shared context", [{ title: "Read-only fixture", task: "ORIGINAL_TASK_ONLY_ONCE" }], selection).taskIds[0];
    const row = () => records.rows("WHERE id=?", taskId)[0];
    const original = records.inputs(row(), "queued")[0];
    agents.onEvent = (eventScope, run, event) => { if (eventScope.sessionId === row().sessionId) scheduler.event(row(), run, event); };
    agents.onSettled = (eventScope, run) => { if (eventScope.sessionId === row().sessionId) { scheduler.settle(row(), run); scheduler.kick(); } };
    scheduler.kick();
    await wait(() => row().status === "failed" && !agents.active(target(row())), "first gate rejection must settle");
    const failed = agents.info(target(row())).run!;
    assert.equal(failed.reasonCode, "BINDING_REJECTED");
    assert.equal(store.bindingRejection(failed.id)?.check, "snapshot");
    assert.equal(requests.length, 0);
    assert.ok(records.initialRetry(row(), failed.id));
    assert.equal(records.inputs(row(), "queued").length, 0, "no automatic replay after denial");
    auth("prepared");
    const retried = scheduler.resume(row(), failed.id, randomUUID());
    assert.equal(retried.inputId, original.id);
    await wait(() => row().status === "completed" && !agents.active(target(row())), "explicit retry must complete the original prompt");
    assert.equal(requests.length, 1);
    assert.equal(borrowed, 2);
    const file = String(store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(row().sessionId)!.file);
    const entries = readFileSync(file, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const users = entries.filter(entry => entry.type === "message" && entry.message.role === "user");
    assert.equal(users.length, 1);
    const body = users[0].message.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
    assert.equal(body, original.body);
    assert.equal(entries.some(entry => entry.type === "custom_message" && entry.customType === "axiom-resume"), false);
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE sessionId=?").get(row().sessionId)!.n, 2);
    assert.equal(records.list(scope).tasks[0].results.length, 2);
    assert.equal(records.list(scope).tasks[0].inputs![0].state, "delivered");
    assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM task_initial_retries").get()!.n, 0);
  } finally {
    await scheduler.close(); await delivery.close(); await closeModelNetworks(root); store.close();
    http.closeAllConnections(); await new Promise<void>(resolve => http.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
