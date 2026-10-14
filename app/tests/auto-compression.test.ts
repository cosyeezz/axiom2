import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer, type ServerResponse } from "node:http";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { autoCompressionThreshold, defaultAutoCompression } from "../src/shared/compression.js";
import { Store } from "../src/server/storage.js";
import { Compressions } from "../src/server/compressions.js";
import { startServer } from "../src/server/index.js";
import type { Scope, Session, Workspace } from "../src/shared/protocol.js";

const wait = async (check: () => boolean, message: string) => {
  const end = Date.now() + 25000;
  while (!check()) {
    assert.ok(Date.now() < end, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test("automatic threshold takes the smaller token limit, rounds fractional capacity up and handles unknown capacity", () => {
  const settings = { enabled: true, tokens: 100000, percent: 80 };
  assert.equal(autoCompressionThreshold(settings, 200000), 100000);
  assert.equal(autoCompressionThreshold(settings, 100000), 80000);
  assert.equal(autoCompressionThreshold(settings, 125000), 100000);
  assert.equal(autoCompressionThreshold({ ...settings, percent: 33 }, 101), 34);
  for (const capacity of [undefined, null, 0, -1, NaN, Infinity])
    assert.equal(autoCompressionThreshold(settings, capacity), 100000);
});

test("automatic compression rearms only after a successful below-threshold reading; capacity skips wait for fresh measurements", async () => {
  const scope = { workspaceId: "workspace", sessionId: "session" };
  const coordinator: any = Object.create(Compressions.prototype);
  const info = { run: { id: "run", status: "running" }, usage: { context: { tokens: 120, window: 32000 } } };
  const job = { state: "completed" };
  let attempts = 0;
  coordinator.automatic = new Map(); coordinator.autoPending = new Set(); coordinator.autoWork = new Set();
  coordinator.live = new Map();
  coordinator.store = { compressionPreferences: () => ({ auto: { enabled: true, tokens: 120, percent: 80 } }) };
  coordinator.agents = { info: () => info };
  coordinator.info = () => job;
  coordinator.start = async () => { attempts++; return {}; };
  const check = async (autoCheck = true) => {
    coordinator.event(scope, "run", { type: "usage", autoCheck });
    await Promise.all(coordinator.autoWork);
  };
  await check(); await check();
  assert.equal(attempts, 1);
  info.usage.context.tokens = 119;
  await check(false); // The applied-context measurement can rearm but cannot start work.
  assert.equal(attempts, 1);
  info.usage.context.tokens = 120;
  await check();
  assert.equal(attempts, 2);
  job.state = "failed";
  info.usage.context.tokens = 119; await check(false);
  info.usage.context.tokens = 120; await check();
  assert.equal(attempts, 2, "failure does not rearm even after later lower readings");
  info.run.id = "next-run";
  for (let i = 0; i < 4; i++) coordinator.live.set(`other-${i}`, {});
  coordinator.event(scope, "next-run", { type: "usage", autoCheck: true });
  assert.equal(attempts, 2);
  coordinator.live.clear();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(attempts, 2, "capacity release does not schedule hidden work");
  coordinator.event(scope, "next-run", { type: "usage", autoCheck: true });
  await Promise.all(coordinator.autoWork);
  assert.equal(attempts, 3);
});

test("legacy compression preference migration retains model and persists explicit automatic settings", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-auto-migrate-"));
  const selection = { provider: "fixture", id: "summary", thinking: "off" as const };
  const legacy = new DatabaseSync(join(root, "axiom.sqlite"));
  legacy.exec("CREATE TABLE compression_preferences(id INTEGER PRIMARY KEY CHECK(id=1),selection TEXT)");
  legacy.prepare("INSERT INTO compression_preferences VALUES(1,?)").run(JSON.stringify(selection));
  legacy.close();
  let store = new Store(root);
  try {
    assert.deepEqual(store.compressionPreferences(), { selection, auto: defaultAutoCompression });
    const auto = { enabled: false, tokens: 45000, percent: 65 };
    store.saveCompressionPreferences({ selection, auto });
    store.close(); store = new Store(root);
    assert.deepEqual(store.compressionPreferences(), { selection, auto });
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("automatic compression uses real pi usage and the chat window, shares persistence, deduplicates and respects cancellation/stop", { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-auto-compression-")), project = join(root, "project");
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  let tokens = 119, holdSummaries = false, summaryRequests = 0, holdChat = false;
  const summaries: ServerResponse[] = [], chats: ServerResponse[] = [];
  const reply = (res: ServerResponse, content: string) => {
    for (const [delta, finish_reason] of [[{ role: "assistant", content }, null], [{}, "stop"]])
      res.write(`data: ${JSON.stringify({ id: randomUUID(), object: "chat.completion.chunk", created: 1,
        model: "chat", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ id: "usage", object: "chat.completion.chunk", created: 1, model: "chat", choices: [],
      usage: { prompt_tokens: tokens - 10, completion_tokens: 10, total_tokens: tokens } })}\n\n`);
    res.end("data: [DONE]\n\n");
  };
  const fixture = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    if (!body.tools?.length) {
      summaryRequests++;
      assert.equal(body.model, "summary", "automatic jobs use the saved independent summary model");
      if (holdSummaries) summaries.push(res);
      else reply(res, "<axiom-summary>自动压缩验证</axiom-summary>\n## Goal\nAUTO_SUMMARY");
    } else if (holdChat) chats.push(res);
    else reply(res, "chat reply");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
    models: [{ id: "chat", contextWindow: 32000, maxTokens: 1000 }, { id: "summary", contextWindow: 1000000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
  // Native proactive compression would fire near zero: Axiom must own this threshold.
  writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: true, reserveTokens: 31999 }, retry: { enabled: false } }));
  let app = await startServer({ root, port: 0 });
  const phases: string[] = [];
  const compressionEvent = app.agents.compressions.event.bind(app.agents.compressions);
  t.mock.method(app.agents.compressions, "event", (scope: Scope, runId: string, event: any) => {
    if (event.type === "progress") phases.push(event.phase);
    compressionEvent(scope, runId, event);
  });
  const preferences = (params: Record<string, unknown>) => app.agents.compressions.command({ op: "compression.preferences.save", requestId: randomUUID(), params });
  try {
    const workspace = app.store.execute({ op: "workspace.open", requestId: randomUUID(), params: { path: project, authorized: true } }) as Workspace;
    const create = async () => {
      const session = app.store.execute({ op: "session.create", requestId: randomUUID(), workspaceId: workspace.id }) as Session;
      const scope = { workspaceId: workspace.id, sessionId: session.id };
      await app.agents.command({ op: "agent.model", requestId: randomUUID(), ...scope,
        params: { selection: { provider: "fixture", id: "chat", thinking: "off" } } });
      return scope;
    };
    const prompt = (scope: Scope) => app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text: "自动压缩测试" } });
    const idle = (scope: Scope) => wait(() => !app.agents.active(scope), "agent did not settle");
    const done = (scope: Scope) => wait(() => app.agents.compressions.info(scope)?.state === "completed",
      `automatic summary did not apply for ${scope.sessionId}`);
    const count = (scope: Scope) => Number(app.store.db.prepare("SELECT COUNT(*) AS n FROM compressions WHERE sessionId=?").get(scope.sessionId)!.n);
    const selection = { provider: "fixture", id: "summary", thinking: "off" as const };
    await preferences({ selection, auto: { tokens: 120, percent: 80 } });
    for (const auto of [{ tokens: 0 }, { tokens: 1.5 }, { tokens: "120" }, { tokens: Number.MAX_SAFE_INTEGER + 1 },
      { percent: 0 }, { percent: 101 }, { percent: 80.5 }, { enabled: "true" }, { extra: 1 }, {}, null])
      await assert.rejects(preferences({ auto }), { code: "INVALID_INPUT" });
    assert.deepEqual(app.store.compressionPreferences(), { selection, auto: { enabled: true, tokens: 120, percent: 80 } });
    await preferences({ auto: { percent: 75 } });
    await preferences({ selection });
    assert.deepEqual(app.store.compressionPreferences().auto, { enabled: true, tokens: 120, percent: 75 }, "model patches preserve thresholds");

    const scope = await create();
    await prompt(scope); await idle(scope);
    assert.equal(count(scope), 0, "below threshold must not compress, including native proactive checks");
    tokens = 120;
    await prompt(scope); await idle(scope); await done(scope);
    assert.equal(count(scope), 1, "equal-to threshold creates exactly one job");
    const job = app.agents.compressions.info(scope)!;
    assert.equal(job.trigger, "auto");
    assert.deepEqual(job.selection, selection);
    const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file);
    assert.equal(SessionManager.open(file).getBranch().filter((entry) => entry.type === "compaction").length, 1);
    const runId = app.agents.info(scope).run!.id;
    for (let i = 0; i < 5; i++) app.agents.compressions.event(scope, runId, { type: "usage", autoCheck: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count(scope), 1, "high usage after application cannot trigger a compression loop");

    // Percent threshold must use the 32k chat model, not the 1M summary model.
    await preferences({ auto: { tokens: 10000, percent: 1 } });
    const percentScope = await create();
    tokens = 319;
    await prompt(percentScope); await idle(percentScope);
    assert.equal(count(percentScope), 0);
    tokens = 320;
    await prompt(percentScope); await idle(percentScope); await done(percentScope);
    assert.equal(count(percentScope), 1);

    await preferences({ auto: { enabled: false, tokens: 1 } });
    const disabledScope = await create();
    await prompt(disabledScope); await idle(disabledScope);
    assert.equal(count(disabledScope), 0, "disabled proactive policy does not invoke either compressor");
    assert.ok(!phases.includes("compacting"), "intercepted native threshold checks must not advertise active compaction");

    await preferences({ auto: { enabled: true, tokens: 120, percent: 80 } });
    holdSummaries = true;
    const cancelScope = await create();
    await prompt(cancelScope); await idle(cancelScope);
    await wait(() => summaries.length > 0, "cancel target did not reach provider");
    await app.agents.compressions.command({ op: "compression.cancel", requestId: randomUUID(), ...cancelScope,
      params: { id: app.agents.compressions.info(cancelScope)!.id } });
    assert.equal(app.agents.compressions.info(cancelScope)!.state, "cancelled");
    for (let i = 0; i < 5; i++) app.agents.compressions.event(cancelScope, app.agents.info(cancelScope).run!.id, { type: "usage", autoCheck: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count(cancelScope), 1, "cancel suppresses repeated events from the same run");

    // A broken saved summary model produces a visible failure without retrying
    // every subsequent usage event; repairing the model does not replay the run.
    holdSummaries = false;
    const failedScope = await create();
    app.store.saveCompressionPreferences({ ...app.store.compressionPreferences(), selection: { ...selection, id: "missing" } });
    const beforeFailure = summaryRequests;
    await prompt(failedScope); await idle(failedScope);
    await wait(() => app.agents.compressions.info(failedScope)?.state === "failed", "missing model failure was not visible");
    assert.match(app.agents.compressions.info(failedScope)!.error!, /压缩模型/);
    await preferences({ selection });
    for (let i = 0; i < 5; i++) app.agents.compressions.event(failedScope, app.agents.info(failedScope).run!.id, { type: "usage", autoCheck: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count(failedScope), 1);
    assert.equal(summaryRequests, beforeFailure, "failure is not silently retried after a configuration edit");
    await prompt(failedScope); await idle(failedScope); await done(failedScope);
    assert.equal(count(failedScope), 2, "a new user execution can try the repaired configuration");

    // A queued start must not cross an explicit stop while waiting for model serialization.
    holdChat = true;
    const stoppedScope = await create();
    await prompt(stoppedScope);
    await wait(() => chats.length > 0, "chat did not reach provider");
    let release!: () => void;
    const lock = app.agents.models.serial(() => new Promise<void>((resolve) => { release = resolve; }));
    await new Promise((resolve) => setImmediate(resolve));
    reply(chats[0], "stop boundary");
    await idle(stoppedScope);
    await app.agents.stop(stoppedScope);
    release(); await lock;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(count(stoppedScope), 0, "stopped pending automatic work cannot launch");

    const requestCount = summaryRequests;
    await app.close(); app = await startServer({ root, port: 0 });
    assert.equal(summaryRequests, requestCount, "restart does not replay automatic jobs");
    assert.deepEqual(app.store.compressionPreferences(), { selection, auto: { enabled: true, tokens: 120, percent: 80 } });
    assert.equal(app.agents.compressions.info(scope)!.id, job.id);
  } finally {
    await app.close();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
    rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
});
