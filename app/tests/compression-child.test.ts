import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { isCompressionRequest } from "./compression-memory-fixture.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 25000;
  while (!check()) {
    assert.ok(Date.now() < end, message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
};

for (const overflow of [false, true]) test(overflow
  ? "obvious prefix overflow dispatches no summary, creates no physical charge and never applies"
  : "real scheduled child compression uses its own model, thinking and cache route, not its parent's", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-compression-child-")), project = join(root, "project");
  const previous = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const requests: any[] = [];
  const reply = (res: ServerResponse, text: string) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [delta, finish_reason] of [[{ role: "assistant", content: text }, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    reply(res, isCompressionRequest(body) ? "## Goal\nChild summary\n## Progress\nCompleted child research." : "Completed read-only child research.");
  });
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
      models: ["parent", "child"].map(id => ({ id, reasoning: true, contextWindow: overflow && id === "child" ? 64 : 64000, maxTokens: 1000 })),
    } } }));
    writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
    writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: false }, retry: { enabled: false } }));
    app = await startServer({ root, port: 0 });
    const server = app;
    await server.agents.compressions.command({ requestId: randomUUID(), op: "compression.preferences.save", params: { auto: { enabled: false } } });
    const workspace = server.store.execute({ requestId: randomUUID(), op: "workspace.open", params: { path: project, authorized: true } }) as Workspace;
    const session = server.store.execute({ requestId: randomUUID(), op: "session.create", workspaceId: workspace.id }) as Session;
    const parent: Scope = { workspaceId: workspace.id, sessionId: session.id };
    const parentSelection = { provider: "fixture", id: "parent", thinking: "high" as const };
    const childSelection = { provider: "fixture", id: "child", thinking: "low" as const };
    await server.agents.command({ ...parent, requestId: randomUUID(), op: "agent.model", params: { selection: parentSelection } });
    // Production task records + scheduler + worker, not a fabricated child JSONL.
    const { taskIds } = new TaskRecords(server.store).create(parent, "child-compression-fixture", "Read-only research", [{ title: "Child research", task: "Return the research result" }], childSelection);
    await server.agents.command({ ...parent, requestId: randomUUID(), op: "prompt", params: { text: "Trigger the normal task scheduler" } });
    await wait(() => server.tasks.list(parent).tasks.find(task => task.id === taskIds[0])?.status === "completed", "real child did not complete");
    const task = server.tasks.list(parent).tasks.find(task => task.id === taskIds[0])!;
    const child = { workspaceId: workspace.id, sessionId: task.sessionId };
    await wait(() => !server.agents.active(child), "child did not settle");
    await server.agents.releaseIdle(child);
    assert.equal(server.agents.info(child).task?.id, task.id);
    assert.deepEqual(server.agents.info(child).selection, childSelection);
    const dispatched = requests.findLast(request => request.model === "child" && !isCompressionRequest(request));
    assert.ok(dispatched, "the real child model received its own chat request");
    assert.equal(dispatched.reasoning_effort, "low");
    const file = String(server.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(child.sessionId)!.file);
    const before = readFileSync(file, "utf8");
    await server.agents.compressions.command({ ...child, requestId: randomUUID(), op: "compression.start", params: {} });
    await wait(() => server.agents.compressions.info(child)?.state !== "running", "child compression did not settle");
    const job = server.agents.compressions.info(child)!;
    if (overflow) {
      assert.equal(job.state, "failed", JSON.stringify(job));
      assert.match(job.error!, /不会截断历史/);
      assert.equal(requests.filter(isCompressionRequest).length, 0, "local budget rejection sends no HTTP summary");
      assert.equal(job.billing?.records ?? 0, 0, "preflight is not a physical request or an unknown charge");
      assert.equal(readFileSync(file, "utf8"), before);
      assert.equal(SessionManager.open(file).getBranch().filter(entry => entry.type === "compaction").length, 0);
      return;
    }
    assert.equal(job.state, "completed", JSON.stringify(job));
    assert.deepEqual(job.selection, childSelection);
    assert.deepEqual(server.agents.info(parent).selection, parentSelection);
    const summaries = requests.filter(isCompressionRequest);
    assert.ok(summaries.length > 0);
    for (const request of summaries) {
      assert.equal(request.model, "child");
      assert.equal(request.reasoning_effort, "low");
      assert.equal(request.prompt_cache_key, dispatched.prompt_cache_key);
      assert.deepEqual(request.messages.slice(0, dispatched.messages.length), dispatched.messages);
      assert.deepEqual(request.tools, dispatched.tools);
    }
    assert.ok(readFileSync(file, "utf8").startsWith(before));
    assert.equal(SessionManager.open(file).getBranch().filter(entry => entry.type === "compaction").length, 1);
  } finally {
    await app?.close();
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
