import { compressionMemoryRead, isCompressionRequest } from "./compression-memory-fixture.js";
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

test("legacy compression preference migration ignores obsolete models and persists automatic settings", () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-auto-migrate-"));
  const selection = { provider: "fixture", id: "summary", thinking: "off" as const };
  const legacy = new DatabaseSync(join(root, "axiom.sqlite"));
  legacy.exec("CREATE TABLE compression_preferences(id INTEGER PRIMARY KEY CHECK(id=1),selection TEXT)");
  legacy.prepare("INSERT INTO compression_preferences VALUES(1,?)").run(JSON.stringify(selection));
  legacy.close();
  let store = new Store(root);
  try {
    assert.deepEqual(store.compressionPreferences(), { auto: defaultAutoCompression });
    const auto = { enabled: false, tokens: 45000, percent: 65 };
    store.saveCompressionPreferences({ auto });
    store.close(); store = new Store(root);
    assert.deepEqual(store.compressionPreferences(), { auto });
    assert.equal(store.db.prepare("SELECT selection FROM compression_preferences WHERE id=1").get()!.selection, null);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("automatic compression uses real pi usage and the chat window, shares persistence, deduplicates and respects cancellation/stop", { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "axiom-auto-compression-")), project = join(root, "project");
  const previousPi = process.env.AXIOM_PI_DIR;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  mkdirSync(project); mkdirSync(join(root, "pi"));
  let tokens = 119, holdSummaries = false, summaryRequests = 0, holdChat = false, failSummaries = false;
  let nativeRequests = 0;
  const chatBodies: any[] = [];
  const summaries: ServerResponse[] = [], chats: ServerResponse[] = [];
  const reply = (res: ServerResponse, content: string | object) => {
    for (const [delta, finish_reason] of [[typeof content === "string" ? { role: "assistant", content } : content, null], [{}, typeof content === "string" ? "stop" : "tool_calls"]])
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
    if (JSON.stringify(body.messages?.[0]?.content).includes("You are a context summarization assistant")) {
      nativeRequests++;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      reply(res, "## Goal\nPI_NATIVE_SAFETY_SUMMARY");
      return;
    }
    if (!isCompressionRequest(body)) chatBodies.push(body);
    if (isCompressionRequest(body) && failSummaries) {
      summaryRequests++;
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "fixture summary failure", type: "invalid_request_error" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" }); res.flushHeaders();
    if (isCompressionRequest(body)) {
      summaryRequests++;
      assert.equal(body.model, "chat", "automatic jobs use the current session model");
      if (holdSummaries) summaries.push(res);
      else reply(res, "<axiom-summary>自动压缩验证</axiom-summary>\n## Goal\nAUTO_SUMMARY");
    } else if (holdChat) chats.push(res);
    else reply(res, compressionMemoryRead(body) ?? "chat reply");
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  writeFileSync(join(root, "pi/models.json"), JSON.stringify({ providers: { fixture: {
    api: "openai-completions", baseUrl: `http://127.0.0.1:${(fixture.address() as any).port}/v1`,
    models: [{ id: "chat", contextWindow: 32000, maxTokens: 1000 }, { id: "summary", contextWindow: 1000000, maxTokens: 1000 }],
  } } }));
  writeFileSync(join(root, "pi/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: "loopback-only" } }));
  // A stale fixed reserve must not override the host's model-relative 70% native safety net.
  writeFileSync(join(root, "pi/settings.json"), JSON.stringify({ compaction: { enabled: true, reserveTokens: 31999, keepRecentTokens: 100 }, retry: { enabled: false } }));
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
    const prompt = (scope: Scope, text = "自动压缩测试") => app.agents.command({ op: "prompt", requestId: randomUUID(), ...scope, params: { text } });
    const idle = (scope: Scope) => wait(() => !app.agents.active(scope), "agent did not settle");
    const done = (scope: Scope) => wait(() => app.agents.compressions.info(scope)?.state === "completed",
      `automatic summary did not apply for ${scope.sessionId}`);
    const count = (scope: Scope) => Number(app.store.db.prepare("SELECT COUNT(*) AS n FROM compressions WHERE sessionId=?").get(scope.sessionId)!.n);
    const selection = { provider: "fixture", id: "chat", thinking: "off" as const };
    await preferences({ auto: { tokens: 120, percent: 80 } });
    for (const auto of [{ tokens: 0 }, { tokens: 1.5 }, { tokens: "120" }, { tokens: Number.MAX_SAFE_INTEGER + 1 },
      { percent: 0 }, { percent: 101 }, { percent: 80.5 }, { enabled: "true" }, { extra: 1 }, {}, null])
      await assert.rejects(preferences({ auto }), { code: "INVALID_INPUT" });
    assert.deepEqual(app.store.compressionPreferences(), { auto: { enabled: true, tokens: 120, percent: 80 } });
    await preferences({ auto: { percent: 75 } });
    await assert.rejects(preferences({ selection }), { code: "INVALID_INPUT" });
    assert.deepEqual(app.store.compressionPreferences().auto, { enabled: true, tokens: 120, percent: 75 }, "rejected model overrides preserve thresholds");

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
    assert.equal(count(disabledScope), 0, "disabled host policy does not invoke Axiom compression");
    assert.ok(!phases.includes("compacting"), "below 70% there is no native compaction");
    assert.equal(nativeRequests, 0);

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

    // Provider failure stays visible and does not retry in the same run, even
    // after provider recovery; a new user execution may try again.
    holdSummaries = false;
    const failedScope = await create();
    failSummaries = true;
    const beforeFailure = summaryRequests;
    await prompt(failedScope); await idle(failedScope);
    await wait(() => app.agents.compressions.info(failedScope)?.state === "failed", "provider summary failure was not visible");
    assert.match(app.agents.compressions.info(failedScope)!.error!, /fixture summary failure/);
    failSummaries = false;
    for (let i = 0; i < 5; i++) app.agents.compressions.event(failedScope, app.agents.info(failedScope).run!.id, { type: "usage", autoCheck: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(count(failedScope), 1);
    assert.equal(summaryRequests, beforeFailure + 1, "failure is not silently retried after provider recovery");
    await prompt(failedScope); await idle(failedScope); await done(failedScope);
    assert.equal(count(failedScope), 2, "a new user execution can try the repaired configuration");

    // Fail only the host's asynchronous summary, then cross Pi's independent 70% threshold.
    const fallbackScope = await create();
    const nativeEntries = (scope: Scope) => {
      const file = String(app.store.db.prepare("SELECT file FROM agent_sessions WHERE sessionId=?").get(scope.sessionId)!.file);
      return SessionManager.open(file).getBranch().filter((entry) => entry.type === "compaction");
    };
    tokens = 200;
    failSummaries = true;
    await prompt(fallbackScope, "FALLBACK_OLD_HISTORY ".repeat(100)); await idle(fallbackScope);
    await wait(() => app.agents.compressions.info(fallbackScope)?.state === "failed", "host failure before fallback was not visible");
    assert.equal(nativeEntries(fallbackScope).length, 0, "Pi must not trigger below 70%");
    const nativeBefore = nativeRequests;
    tokens = 22401; // Pi is strict > 70% of the 32k window.
    await prompt(fallbackScope); await idle(fallbackScope);
    await wait(() => app.agents.compressions.info(fallbackScope)?.state === "failed", "host failure must remain visible after native recovery");
    assert.ok(nativeRequests > nativeBefore, "Pi issued its own standalone summary request");
    const checkpoints = nativeEntries(fallbackScope);
    assert.equal(checkpoints.length, 1);
    assert.match(checkpoints[0].summary, /PI_NATIVE_SAFETY_SUMMARY/);
    assert.ok(!(checkpoints[0].details as any)?.axiomCompressionId, "native success is not reported as host success");
    assert.ok(phases.includes("compacting"), "actual native compaction publishes its real phase");
    failSummaries = false;
    await preferences({ auto: { enabled: false } });
    tokens = 100;
    await prompt(fallbackScope); await idle(fallbackScope);
    const rebuilt = JSON.stringify(chatBodies.at(-1).messages);
    assert.match(rebuilt, /PI_NATIVE_SAFETY_SUMMARY/);
    assert.doesNotMatch(rebuilt, /FALLBACK_OLD_HISTORY/);
    assert.match(rebuilt, /上下文压缩已实际应用/, "native compaction also asks the session to recover memory");

    // Turning off Axiom does not turn off Pi; memory-enabled main sessions also allow overflow.
    for (const measured of [22401, 33000]) {
      const independentScope = await create();
      tokens = 100;
      await prompt(independentScope, "INDEPENDENT_HISTORY ".repeat(100)); await idle(independentScope);
      tokens = measured;
      // Give Pi a genuine older span to summarize while retaining this new span.
      // Inflated provider usage alone cannot make a tiny transcript compressible.
      await prompt(independentScope, "INDEPENDENT_CURRENT_INPUT ".repeat(100)); await idle(independentScope);
      assert.equal(count(independentScope), 0);
      assert.equal(nativeEntries(independentScope).length, 1, `native recovery at ${measured} must remain enabled`);
    }
    await preferences({ auto: { enabled: true, tokens: 120, percent: 80 } });
    tokens = 120;

    // A pending start must not cross an explicit stop during its configuration read.
    holdChat = true;
    const stoppedScope = await create();
    await prompt(stoppedScope);
    await wait(() => chats.length > 0, "chat did not reach provider");
    const originalRaw = app.agents.models.raw.bind(app.agents.models);
    let release!: () => void, reading = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const pendingRead = t.mock.method(app.agents.models, "raw", async () => {
      reading = true;
      await gate;
      return originalRaw();
    });
    try {
      reply(chats[0], "stop boundary");
      await wait(() => reading, "automatic start never reached configuration read");
      await app.agents.stop(stoppedScope);
      release();
      await idle(stoppedScope);
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(count(stoppedScope), 0, "stopped pending automatic work cannot launch");
    } finally { release(); pendingRead.mock.restore(); }

    const requestCount = summaryRequests;
    await app.close(); app = await startServer({ root, port: 0 });
    assert.equal(summaryRequests, requestCount, "restart does not replay automatic jobs");
    assert.deepEqual(app.store.compressionPreferences(), { auto: { enabled: true, tokens: 120, percent: 80 } });
    assert.equal(app.agents.compressions.info(scope)!.id, job.id);
  } finally {
    await app.close();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
    if (previousPi === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousPi;
    rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
  }
});
