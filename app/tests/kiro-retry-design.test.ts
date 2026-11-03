// Design probes only. Nothing in production imports these proposed adapters.
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { Type, createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AdaptiveRetryStrategy, StandardRetryStrategy } from "@smithy/core/retry";
import { createModelRuntime } from "../src/server/model-runtime.js";

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) {
  const end = performance.now() + 4000;
  while (!predicate()) { assert.ok(performance.now() < end, "design probe deadline"); await tick(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Host run scope, independent of Pi's resettable internal turnIndex. */
class ProposedTurns {
  position = 0;
  active = false;
  eligible = true;
  retryScheduled = false;
  beginFreshRun() { this.position = 0; this.active = false; this.eligible = true; this.retryScheduled = false; }
  observe(event: AgentSessionEvent) {
    if ("parentToolCallId" in event && event.parentToolCallId) return;
    if (event.type === "auto_retry_start") this.retryScheduled = true;
    else if (event.type === "turn_start") {
      if (!this.retryScheduled) this.position++;
      this.retryScheduled = false;
      this.active = true;
    } else if (event.type === "turn_end" || event.type === "agent_settled") this.active = false;
    // Official graph compaction/reset semantics remain unproven; do not guess.
    else if (event.type === "compaction_start") this.eligible = false;
    else if (event.type === "auto_retry_end" && !event.success) this.retryScheduled = false;
  }
  request(sessionId: string | undefined, expected: string) {
    return this.active && this.eligible && sessionId === expected ? this.position : undefined;
  }
}
function message(kind: "error" | "toolUse" | "stop", index: number): AssistantMessage {
  return { role: "assistant", api: "openai-completions", provider: "openai", model: "retry-design", timestamp: Date.now(),
    content: kind === "error" ? [] : kind === "toolUse" ? [{ type: "toolCall", id: `owned-${index}`, name: "owned_tool", arguments: {} }]
      : [{ type: "text", text: "OWNED_DESIGN_SUCCESS" }], stopReason: kind,
    ...(kind === "error" ? { errorMessage: "503 service unavailable" } : {}),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
async function sessionFixture(t: TestContext) {
  t.mock.method(globalThis, "fetch", async () => { throw Error("Network forbidden in design probe"); });
  const root = mkdtempSync(join(tmpdir(), "kiro-retry-design-")), agentDir = join(root, "pi"); mkdirSync(agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { openai: { api: "openai-completions", baseUrl: "https://fixture.invalid/v1", models: [{ id: "retry-design", contextWindow: 8192, maxTokens: 1024 }] } } }));
  const credentials = new InMemoryCredentialStore(); await credentials.modify("openai", async () => ({ type: "api_key", key: "OWNED-FIXTURE" }));
  const runtime = await createModelRuntime({ providerIds: ["openai"], modelsPath, credentials, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
  const settings = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 },
    retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, systemPrompt: "", appendSystemPrompt: [] });
  await loader.reload();
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: "user", content: "OWNED_OLD_CONTEXT".repeat(40), timestamp: 1 });
  manager.appendMessage(message("stop", 0));
  let tools = 0;
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: runtime.getModel("openai", "retry-design")!,
    thinkingLevel: "off", settingsManager: settings, resourceLoader: loader, sessionManager: manager, tools: ["owned_tool"], noTools: "builtin",
    customTools: [{ name: "owned_tool", label: "Owned tool", description: "Increment a local counter", parameters: Type.Object({}),
      async execute() { tools++; return { content: [{ type: "text", text: "OWNED_TOOL_RESULT" }], details: undefined }; } }] });
  t.after(() => session.dispose());
  return { session, manager, tools: () => tools };
}

test("public Pi events distinguish graph progress, SDK retry, new host run and summary", async t => {
  const f = await sessionFixture(t), turns = new ProposedTurns(), positions: Array<number | undefined> = [], events: string[] = [];
  let calls = 0, summarizing = false, summaryCalls = 0;
  f.session.subscribe(event => { turns.observe(event); events.push(event.type);
    if (event.type === "compaction_start") summarizing = true;
    if (event.type === "compaction_end") summarizing = false;
  });
  f.session.agent.streamFunction = (_model, _context, options) => {
    positions.push(turns.request(options?.sessionId, f.manager.getSessionId()));
    const count = ++calls;
    const kind = summarizing ? (++summaryCalls === 1 ? "error" : "stop") : count === 1 ? "error" : count === 2 ? "toolUse" : "stop";
    const output = message(kind, count), stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: output });
    if (kind === "error") stream.push({ type: "error", reason: "error", error: output });
    else stream.push({ type: "done", reason: kind, message: output });
    stream.end(); return stream;
  };
  turns.beginFreshRun(); await f.session.prompt("OWNED_FIRST_QUERY");
  assert.deepEqual(positions, [1, 1, 2]); assert.equal(f.tools(), 1);
  assert.equal(events.filter(type => type === "agent_start").length, 2);
  assert.equal(events.filter(type => type === "turn_start").length, 3);
  assert.equal(turns.request(f.manager.getSessionId(), f.manager.getSessionId()), undefined);
  turns.beginFreshRun(); await f.session.prompt("OWNED_NEXT_QUERY"); assert.equal(positions[3], 1);
  const compacted = await f.session.compact();
  // keepRecentTokens=1 splits the turn: history summary (+one retry), then turn-prefix summary.
  assert.match(compacted.summary, /Turn Context \(split turn\)/);
  assert.equal(summaryCalls, 3); assert.deepEqual(positions.slice(4), [undefined, undefined, undefined]);
  assert.equal(events.filter(type => type === "summarization_retry_scheduled").length, 1);
  assert.equal(events.filter(type => type === "auto_retry_start").length, 1);
  assert.equal(turns.eligible, false); // Recovery cannot silently re-enable a guessed graph identity.
});

/** Abort the caller without releasing the underlying operation's ownership. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  });
}
class ProposedOwner {
  private tail = Promise.resolve();
  run<T>(signal: AbortSignal, work: () => Promise<T>) {
    const operation = this.tail.then(() => { signal.throwIfAborted(); return work(); });
    this.tail = operation.then(() => undefined, () => undefined);
    return abortable(operation, signal);
  }
}
test("aborted acquisition cannot send late or release successors before SDK state settles", async () => {
  const owner = new ProposedOwner(), acquire = deferred<void>(), first = new AbortController(), second = new AbortController();
  let sdkSettled = 0, sent = 0, enteredSecond = false;
  const firstWork = owner.run(first.signal, async () => { await acquire.promise; sdkSettled++; first.signal.throwIfAborted(); sent++; });
  await tick(); first.abort(new Error("owned cancellation")); await assert.rejects(firstWork, /owned cancellation/);
  const secondWork = owner.run(second.signal, async () => { enteredSecond = true; assert.equal(sdkSettled, 1); second.signal.throwIfAborted(); sent++; });
  await tick(); assert.equal(enteredSecond, false); assert.equal(sent, 0);
  acquire.resolve(); await secondWork; assert.equal(sent, 1);
});
test("queued cancellation cannot bypass a pending owner or run later", async () => {
  const owner = new ProposedOwner(), acquire = deferred<void>(), first = new AbortController(), queued = new AbortController();
  let queuedCalls = 0;
  const firstWork = owner.run(first.signal, () => acquire.promise);
  const queuedWork = owner.run(queued.signal, async () => { queuedCalls++; });
  queued.abort(new Error("queued cancelled")); await assert.rejects(queuedWork, /queued cancelled/);
  acquire.resolve(); await firstWork; await tick(); assert.equal(queuedCalls, 0);
});

test("installed Smithy options object loses functional budgets; no-options form preserves them", async () => {
  let budget = 4;
  const dynamic = new AdaptiveRetryStrategy(async () => budget);
  const replaced = new AdaptiveRetryStrategy(async () => budget, { rateLimiter: { getSendToken: async () => {}, updateClientSendingRate: () => {} } });
  assert.equal(await dynamic.maxAttemptsProvider(), 4); assert.equal(await replaced.maxAttemptsProvider(), 3);
  budget = 6; assert.equal(await dynamic.maxAttemptsProvider(), 6); assert.equal(await replaced.maxAttemptsProvider(), 3);
});
test("installed Smithy waits inside acquisition; a Qne-shaped token refunds only one", async t => {
  t.mock.method(Math, "random", () => 0.5); t.mock.timers.enable({ apis: ["setTimeout"] });
  const strategy = new StandardRetryStrategy(async () => 3), initial = await strategy.acquireInitialRetryToken("owned-design");
  let done = false;
  const pending = strategy.refreshRetryTokenForRetry(initial, { errorType: "TRANSIENT" }).then(token => { done = true; return token; });
  await tick(); assert.equal(done, false); const remaining = strategy.getCapacity();
  // Both shipped branches are known, but this process only exercises its active one.
  const delay = remaining === 490 ? 50 : remaining === 486 ? 25 : undefined;
  assert.notEqual(delay, undefined); t.mock.timers.tick(delay! - 1); await tick(); assert.equal(done, false);
  t.mock.timers.tick(1); await until(() => done); const renewed = await pending;
  assert.equal(renewed.getRetryCount(), 1); assert.equal(renewed.getRetryDelay(), 0);
  strategy.recordSuccess({ getRetryCount: () => 1, getRetryDelay: () => 250, getRetryCost: () => undefined });
  assert.equal(strategy.getCapacity(), remaining + 1);
  t.diagnostic(`Smithy branch: ${remaining === 490 ? "default" : "2026"}; internal delay ${delay}ms; refund1`);
});
