import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { nativeInputs, recallNativeInputs } from "../src/server/agents/native-queue.js";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startServer } from "../src/server/index.js";
import type { Session, Workspace, Scope } from "../src/shared/protocol.js";
import { running } from "../src/shared/agent.js";
import { TaskRecords, target } from "../src/server/tasks/records.js";

const wait = async (check: () => boolean, label: string) => {
  const end = Date.now() + 25000;
  while (!check()) {
    if (Date.now() > end) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
test("native queue ID recall preserves same-text notifications, extensions and consumed inputs", () => {
  const agent = new Agent({ streamFn: () => { throw Error("queue-only test must not call a model"); } });
  const session = { agent } as AgentSession;
  const message = (id: string, customType = "axiom-append") => ({
    role: "custom" as const, customType, content: "same text", display: true,
    details: { axiomInput: id }, timestamp: 1,
  });
  const notification = message("notice", "axiom-result"), extension = message("extension", "other");
  agent.steer(message("one")); agent.steer(notification); agent.steer(message("two"));
  agent.followUp(extension); agent.followUp(message("three"));
  assert.deepEqual(nativeInputs(session).map((input) => input.id), ["one", "two", "three"]);
  assert.deepEqual(recallNativeInputs(session, new Set(["one", "two", "three", "notice"])), ["one", "two", "three"]);
  assert.deepEqual(agent.peekQueuedMessages(), [notification]);
  agent.clearSteeringQueue();
  assert.deepEqual(agent.peekQueuedMessages(), [extension]);
  assert.deepEqual(recallNativeInputs(session, new Set(["one"])), []);
  assert.throws(() => nativeInputs({ agent: {} } as AgentSession), /Unsupported/);
});

test("worker steering: original drafts, request dedupe, scope isolation, consume boundary and no replay", { timeout: 90000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-steering-")), project = join(root, "project");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  const old = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => { if (old === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = old; });
  const bodies: any[] = [], releases: (() => void)[] = [];
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    releases.push(() => {
      const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      chunk({ role: "assistant", content: "boundary" }); chunk({}, "stop"); res.end("data: [DONE]\n\n");
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`, models: [{ id: "fixture" }],
  } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "fixture" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  const app = await startServer({ root, port: 0 });
  try {
    const w = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const s = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: w.id }) as Session;
    const scope = { workspaceId: w.id, sessionId: s.id };
    const call = (op: string, params: Record<string, unknown> = {}, to: Scope = scope, requestId = randomUUID()) => app.tasks.command({ op, params, ...to, requestId });
    await call("agent.model", { selection: { provider: "fixture", id: "fixture", thinking: "off" } });
    await call("prompt", { text: "initial" });
    await wait(() => bodies.length === 1, "first model request");
    const attachments = [{ id: "file1", name: "path.txt", path: join(project, "path.txt"), kind: "file", text: "" }];
    const requestId = randomUUID(), params = { text: "  retain exact text [file1]  ", attachments };
    const first = await call("prompt", params, scope, requestId);
    assert.deepEqual(await call("prompt", params, scope, requestId), first);
    assert.equal(app.agents.info(scope).queue?.length, 1);
    await assert.rejects(call("prompt", { text: "conflict" }, scope, requestId), { code: "REQUEST_CONFLICT" });
    await assert.rejects(call("agent.recall", {}, { ...scope, workspaceId: "wrong" }));
    const recallId = randomUUID();
    const recalled = await call("agent.recall", {}, scope, recallId) as any;
    assert.equal(recalled.drafts[0].text, params.text);
    assert.deepEqual(recalled.drafts[0].attachments, attachments);
    assert.deepEqual(await call("agent.recall", {}, scope, recallId), recalled);
    assert.equal(app.agents.info(scope).queue?.length, 0);
    await call("prompt", { text: "consume this" });
    assert.ok(!app.agents.messages(scope).some((m) => m?.text.includes("consume this")), "accepted steering must not enter transcript before consumption");
    releases[0]();
    await wait(() => bodies.length === 2, "steering must continue native run");
    assert.match(JSON.stringify(bodies[1].messages), /consume this/);
    assert.doesNotMatch(JSON.stringify(bodies[1].messages), /retain exact text/);
    await wait(() => app.agents.info(scope).queue?.length === 0, "consumed queue removed");
    await wait(() => app.agents.messages(scope).filter((m) => m?.role === "user" && m.text === "consume this").length === 1, "consumed steering appears exactly once in transcript");
    assert.deepEqual(await call("agent.recall"), { drafts: [] });
    releases[1]();
    await wait(() => !running(app.agents.info(scope).run), "settled");
    await call("prompt", { text: "new explicit run", mode: "steer" });
    await wait(() => bodies.length === 3, "idle starts normally");
    await call("prompt", { text: "never replay" });
    await call("agent.stop", { runId: app.agents.info(scope).run!.id });
    assert.equal(app.agents.info(scope).queue?.length, 0);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(bodies.length, 3);
    // A frozen parent does not prevent an explicit child prompt; no notice wake.
    const records = new TaskRecords(app.store);
    const id = records.create(scope, "test-anchor", "explicit background", [{ task: "child initial" }],
      { provider: "fixture", id: "fixture", thinking: "off" }).taskIds[0];
    const child = target(records.rows("WHERE id=?", id)[0]);
    await call("prompt", { text: "queued child draft" }, child);
    await wait(() => bodies.length === 4, "child launched");
    await wait(() => app.agents.info(child).queue?.length === 1, "child native queue projection");
    const childRecall = await call("agent.recall", {}, child) as any;
    assert.equal(childRecall.drafts[0].text, "queued child draft");
    await call("prompt", { text: "live child draft", attachments }, child);
    await wait(() => app.agents.info(child).queue?.length === 1, "running child draft shown");
    assert.equal((await call("agent.recall", {}, child) as any).drafts[0].text, "live child draft");
    releases[3]();
    await wait(() => !running(app.agents.info(child).run), "child settled without recalled work");
    assert.equal(bodies.length, 4);
    assert.equal(app.agents.info(child).queue?.length, 0);
  } finally {
    await app.close(); fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
