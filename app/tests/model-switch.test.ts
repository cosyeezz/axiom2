import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { startServer } from "../src/server/index.js";
import { replyToFixtureTitle } from "./model-request-fixture.js";
import { lastRequestSelection, requestSelection, selectionChange } from "../src/server/request-selection.js";
import { threadGroups } from "../src/shared/thread-layout.js";
import { running, type Selection, type ChatMessage } from "../src/shared/agent.js";
import type { Session, Workspace } from "../src/shared/protocol.js";

const first: Selection = { provider: "switch-fixture", id: "model-a", thinking: "high" };
const second: Selection = { ...first, id: "model-b", thinking: "low" };
const change = { from: first, to: second };
const wait = async (check: () => boolean, label: string) => {
  const end = Date.now() + 25000;
  while (!check()) {
    if (Date.now() > end) throw Error(label);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("selection changes require a request, survive old transcripts and ignore menu-only entries", () => {
  const manager = SessionManager.inMemory();
  manager.appendModelChange(first.provider, first.id);
  manager.appendThinkingLevelChange("high");
  assert.equal(lastRequestSelection(manager.getBranch()), undefined);
  manager.appendMessage({ role: "assistant", provider: first.provider, model: first.id, content: [], timestamp: 1 } as any);
  manager.appendModelChange(second.provider, second.id);
  manager.appendThinkingLevelChange("low");
  assert.deepEqual(lastRequestSelection(manager.getBranch()), first);
  assert.equal(selectionChange(undefined, first), undefined);
  assert.equal(selectionChange(first, { ...first }), undefined);
  assert.deepEqual(selectionChange(first, second), change);
  assert.ok(selectionChange(first, { ...first, thinking: "low" }));
  const synthetic = { role: "assistant", provider: second.provider, model: second.id, stopReason: "error", timestamp: 2, content: [] };
  assert.equal(requestSelection(synthetic, "low"), undefined);
  manager.appendMessage(synthetic as any);
  assert.deepEqual(lastRequestSelection(manager.getBranch()), first, "local failure cannot replace the previous request");
  const providerError = { ...synthetic, thinkingLevel: "low" };
  assert.deepEqual(requestSelection(providerError), second, "real zero-usage HTTP errors still record the selected model");
});

test("change sits above the matching request or resumed process and is not folded into earlier activity", () => {
  const messages: ChatMessage[] = [
    { id: "old", role: "assistant", text: "", calls: [{ id: "c", name: "read", input: "{}" }] },
    { id: "request", runId: "run", role: "user", text: "new request" },
    { id: "reply", runId: "run", role: "assistant", text: "", thinking: "working", selectionChange: change },
    { id: "next", runId: "run", role: "assistant", text: "answer" },
    { id: "resume", runId: "resume", role: "assistant", text: "", thinking: "retry", selectionChange: change },
  ];
  const groups = threadGroups(messages);
  assert.deepEqual(groups.filter((g) => g.selectionChange).map((g) => g.ids[0]), ["request", "resume"]);
  const resumed = threadGroups([messages[0], messages[4]]);
  assert.equal(resumed.length, 2);
  assert.deepEqual(resumed[1].selectionChange, change);
});

test("real worker applies model/effort to the next run, retains active steering settings and persists notices", { timeout: 90000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-model-switch-")), project = join(root, "project");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  mkdirSync(join(project, ".pi", "extensions"), { recursive: true });
  writeFileSync(join(project, ".pi", "extensions", "preflight.ts"), `
    import { existsSync } from "node:fs";
    import { join } from "node:path";
    export default function(pi) {
      pi.on("context", (event, ctx) => existsSync(join(ctx.cwd, "block-request"))
        ? { messages: [null] } : { messages: event.messages });
    }
  `);
  const oldPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  t.after(() => { if (oldPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = oldPi; });
  const bodies: any[] = [], releases: (() => void)[] = [];
  let failNext = false, truncateNext = false;
  let summaries = 0;
  const fixture = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if ((body.messages ?? []).some((message: any) => ["system", "developer"].includes(message.role) && typeof message.content === "string" && message.content.includes("为会话生成简明标题"))) {
      replyToFixtureTitle(body, res);
      return;
    }
    bodies.push(body);
    if (failNext) {
      failNext = false;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture rejected request" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    const chunk = (delta: unknown, finish_reason: string | null = null) => res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    chunk({ role: "assistant", content: "working" });
    if (!body.tools?.length) {
      summaries++;
      chunk({ content: " summary" }); chunk({}, "stop"); res.end("data: [DONE]\n\n");
      return;
    }
    const finishReason = truncateNext ? "length" : "stop";
    truncateNext = false;
    releases.push(() => { chunk({ content: " done" }); chunk({}, finishReason); res.end("data: [DONE]\n\n"); });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi", "models.json"), JSON.stringify({ providers: { [first.provider]: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
    models: [first.id, second.id].map((id) => ({ id, reasoning: true, contextWindow: 32000, maxTokens: 1000 })),
  } } }));
  writeFileSync(join(root, "pi", "auth.json"), JSON.stringify({ [first.provider]: { type: "api_key", key: "isolated-fixture" } }));
  writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false }, compaction: { enabled: false } }));
  let app = await startServer({ root, port: 0 });
  try {
    const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id };
    const call = (op: string, params: Record<string, unknown>) => app.agents.command({ op, params, ...scope, requestId: randomUUID() });
    const notices = () => app.agents.thread(scope).groups!.filter((g) => g.selectionChange);
    const finish = async (index: number) => {
      releases[index]();
      await wait(() => !running(app.agents.info(scope).run), "execution settles");
      assert.equal(app.agents.info(scope).run!.status, "completed", app.agents.info(scope).run!.error ?? "");
    };
    await call("agent.model", { selection: first });
    await call("prompt", { text: "first request" });
    await wait(() => releases.length === 1, "first request starts");
    assert.equal(notices().length, 0, "initial selection is not a change");
    await call("agent.model", { selection: second });
    assert.deepEqual(app.agents.info(scope).selection, second);
    assert.deepEqual(app.agents.info(scope).run!.selection, first);
    assert.equal(notices().length, 0, "menu confirmation does not claim application");
    await call("prompt", { text: "steer current execution" });
    releases[0]();
    await wait(() => releases.length === 2, "steering request starts");
    assert.deepEqual(bodies.slice(0, 2).map((b) => [b.model, b.reasoning_effort]), [[first.id, "high"], [first.id, "high"]]);
    await finish(1);
    assert.equal(notices().length, 0);

    await call("prompt", { text: "new model request" });
    await wait(() => releases.length === 3 && notices().length === 1, "change visible during streaming");
    assert.deepEqual([bodies[2].model, bodies[2].reasoning_effort], [second.id, "low"]);
    assert.deepEqual(notices()[0].selectionChange, change);
    assert.equal(app.agents.message(scope, notices()[0].id)?.text, "new model request");
    await finish(2);

    const effort = { ...second, thinking: "high" as const };
    await call("agent.model", { selection: effort });
    await call("prompt", { text: "effort only" });
    await wait(() => releases.length === 4 && notices().length === 2, "effort change streams");
    assert.equal(bodies[3].reasoning_effort, "high");
    assert.deepEqual(notices()[1].selectionChange, { from: second, to: effort });
    await finish(3);
    await call("agent.model", { selection: first });
    await call("agent.model", { selection: effort });
    await call("prompt", { text: "same effective selection" });
    await wait(() => releases.length === 5, "unchanged request starts");
    await finish(4);
    assert.equal(notices().length, 2, "switching away and back without a request produces no notice");

    failNext = true;
    await call("agent.model", { selection: first });
    await call("prompt", { text: "failed response" });
    await wait(() => !running(app.agents.info(scope).run), "failed response settles");
    assert.equal(app.agents.info(scope).run!.status, "failed");
    assert.deepEqual(notices().at(-1)?.selectionChange, { from: effort, to: first });
    await call("agent.model", { selection: second });
    await call("agent.resume", { expectedRunId: app.agents.info(scope).run!.id });
    const resumedRunId = app.agents.info(scope).run!.id;
    await wait(() => releases.length === 6 && app.agents.messages(scope).some((message) =>
      message?.role === "assistant" && message.runId === resumedRunId && !!message.selectionChange),
    "resume change streams without a user message");
    assert.equal(app.agents.message(scope, notices().at(-1)!.id)?.runId, resumedRunId);
    assert.equal(app.agents.message(scope, notices().at(-1)!.id)?.role, "assistant");
    assert.deepEqual(notices().at(-1)?.selectionChange, change);
    await finish(5);

    const beforeLocalFailure = notices();
    writeFileSync(join(project, "block-request"), "force a context conversion failure before HTTP");
    await call("agent.model", { selection: first });
    await call("prompt", { text: "local preflight failure" });
    await wait(() => !running(app.agents.info(scope).run), "local failure settles");
    assert.equal(app.agents.info(scope).run!.status, "failed");
    assert.equal(bodies.length, 7, "context conversion fails before a provider request");
    assert.deepEqual(notices(), beforeLocalFailure, "synthetic assistant cannot announce application");
    rmSync(join(project, "block-request"));
    await app.close(); app = await startServer({ root, port: 0 });
    await call("prompt", { text: "actual request after local failure" });
    await wait(() => releases.length === 7, "real request starts after failed preflight and restart");
    await finish(6);
    assert.deepEqual(notices().at(-1)?.selectionChange, { from: second, to: first });

    writeFileSync(join(root, "pi", "settings.json"), JSON.stringify({ retry: { enabled: false },
      compaction: { enabled: true, reserveTokens: 1000, keepRecentTokens: 1 } }));
    const beforeTruncation = notices();
    truncateNext = true;
    await call("agent.model", { selection: second });
    await call("prompt", { text: "recover a truncated switched response" });
    await wait(() => releases.length === 8, "truncated response starts");
    releases[7]();
    await wait(() => !running(app.agents.info(scope).run), "truncated execution settles through the host compression flow");
    assert.equal(releases.length, 8, "native overflow cannot start an automatic retry");
    assert.equal(summaries, 0, "native overflow cannot bypass host compression preparation");
    assert.deepEqual(notices(), beforeTruncation, "native recovery omits the truncated response from the visible projection");
    await app.agents.compressions.command({ op: "compression.start", ...scope, requestId: randomUUID() });
    await wait(() => releases.length === 9, "platform compression prepares session memory");
    releases[8]();
    await wait(() => app.agents.compressions.info(scope)?.state !== "running" && !running(app.agents.info(scope).run), "platform compression settles");
    assert.equal(app.agents.compressions.info(scope)?.state, "completed", app.agents.compressions.info(scope)?.error ?? undefined);
    assert.ok(summaries > 0, "platform compression sends the summary request");
    await call("agent.model", { selection: first });
    await call("prompt", { text: "request after platform compression" });
    await wait(() => releases.length === 10, "request after compression starts");
    await finish(9);
    assert.deepEqual(notices().at(-1)?.selectionChange, { from: second, to: first }, "compaction preserves the last effective selection");
    assert.doesNotMatch(JSON.stringify(bodies.map((b) => b.messages)), /axiomSelectionChange|后续请求生效/);
    const before = notices(), requestCount = bodies.length;
    await app.close(); app = await startServer({ root, port: 0 });
    assert.deepEqual(notices(), before, "native JSONL restores the same request anchors and changes");
    assert.equal(bodies.length, requestCount, "reopening history never sends another request");
  } finally {
    await app.close(); fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
