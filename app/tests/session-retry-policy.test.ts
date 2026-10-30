import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "./temporary.js";
import { createAssistantMessageEventStream, InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { installSessionRetryPolicy, sessionRetrySettings } from "../src/server/session-retry-policy.js";
import { retryDelayText, sessionRetryDelaysMs } from "../src/shared/retry-policy.js";

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(check: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!check()) { assert.ok(performance.now() < deadline, "native retry did not reach the expected state"); await turn(); }
}
function response(error?: string): AssistantMessage {
  return { role: "assistant", api: "openai-completions", provider: "openai", model: "retry-fixture", timestamp: Date.now(),
    content: error ? [] : [{ type: "text", text: "FIXTURE_SUCCESS" }], stopReason: error ? "error" : "stop", ...(error ? { errorMessage: error } : {}),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}
async function fixture(t: TestContext, options: { retry?: NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>["retry"]; history?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-nine-retries-")), agentDir = join(root, "pi"); mkdirSync(agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { openai: { api: "openai-completions", baseUrl: "https://fixture.invalid/v1", models: [{ id: "retry-fixture", contextWindow: 8192, maxTokens: 1024 }] } } }));
  const credentials = new InMemoryCredentialStore(); await credentials.modify("openai", async () => ({ type: "api_key", key: "OWNED-FIXTURE" }));
  const runtime = await createModelRuntime({ providerIds: ["openai"], modelsPath, credentials, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
  const settings = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 1 }, retry: options.retry });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings, noExtensions: true, noSkills: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, systemPrompt: "", appendSystemPrompt: [] });
  await loader.reload();
  const manager = SessionManager.inMemory(root);
  if (options.history) {
    manager.appendMessage({ role: "user", content: "EARLY_HISTORY", timestamp: 1 }); manager.appendMessage(response());
    manager.appendMessage({ role: "user", content: "CURRENT_REQUEST", timestamp: 2 });
    manager.appendMessage({ ...response(), content: [{ type: "text", text: "LATEST_RETAINED_REPLY".repeat(20) }] });
  }
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model: runtime.getModel("openai", "retry-fixture")!, thinkingLevel: "off", settingsManager: settings, resourceLoader: loader, sessionManager: manager, noTools: "all" });
  t.after(() => session.dispose());
  installSessionRetryPolicy(session);
  const installed = (session as any)._prepareRetry; installSessionRetryPolicy(session);
  assert.equal((session as any)._prepareRetry, installed, "installation is idempotent");
  let calls = 0, output: (call: number) => AssistantMessage = () => response("Request timed out.");
  session.agent.streamFunction = () => {
    const message = output(++calls), stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: message });
    if (message.stopReason === "error") stream.push({ type: "error", reason: "error", error: message });
    else stream.push({ type: "done", reason: "stop", message });
    stream.end(); return stream;
  };
  const events: AgentSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  const retries = () => events.filter((event): event is Extract<AgentSessionEvent, { type: "auto_retry_start" }> => event.type === "auto_retry_start");
  return { session, settings, manager, events, retries, calls: () => calls, respond: (next: typeof output) => { output = next; } };
}

test("session defaults are nine exact waits; explicit settings and provider/summary policies stay intact", async () => {
  const settings = SettingsManager.inMemory(), before = settings.getSettings();
  const policy = sessionRetrySettings(settings);
  assert.deepEqual(policy, { enabled: true, maxRetries: 9, baseDelayMs: 2000, maxAgentDelayMs: 1_800_000,
    delaysMs: [2000, 4000, 8000, 16000, 32000, 120000, 240000, 480000, 1800000] });
  assert.equal(policy.delaysMs!.reduce((sum, delay) => sum + delay, 0), 2_702_000);
  assert.deepEqual(policy.delaysMs!.map(retryDelayText), ["2 秒", "4 秒", "8 秒", "16 秒", "32 秒", "2 分钟", "4 分钟", "8 分钟", "30 分钟"]);
  policy.delaysMs![0] = 0; assert.equal(sessionRetrySettings(settings).delaysMs![0], 2000, "callers cannot mutate defaults");
  assert.deepEqual(settings.getSettings(), before, "derived defaults are not persisted");
  assert.equal(settings.getRetrySettings().maxRetries, 3, "unadapted native summary policy is unchanged");
  const provider = settings.getProviderRetrySettings();
  settings.applyOverrides({ retry: { enabled: false, maxRetries: 2, baseDelayMs: 5, maxAgentDelayMs: 20 } });
  assert.deepEqual(sessionRetrySettings(settings), { enabled: false, maxRetries: 2, baseDelayMs: 5, maxAgentDelayMs: 20 });
  assert.deepEqual(settings.getProviderRetrySettings(), provider);
  await settings.reload(); assert.equal(sessionRetrySettings(settings).maxRetries, 9);
  assert.deepEqual(sessionRetrySettings(SettingsManager.inMemory({ retry: { maxRetries: 0 } })).delaysMs, [...sessionRetryDelaysMs]);
  const project = SettingsManager.fromStorage({ withLock(scope, read) { read(JSON.stringify(scope === "global" ? { retry: { maxRetries: 4, baseDelayMs: 3 } } : { retry: { maxRetries: 1 } })); } });
  assert.equal(sessionRetrySettings(project).maxRetries, 1); assert.equal(sessionRetrySettings(project).baseDelayMs, 3);
  assert.equal(sessionRetrySettings(project).delaysMs, undefined, "explicit timing keeps native exponential backoff");
});

test("real AgentSession retries exactly nine times at exact deadlines, then settles after ten requests", async t => {
  const f = await fixture(t), getter = f.settings.getRetrySettings;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = f.session.prompt("OWNED_TIMEOUT_QUERY");
  for (const [index, delay] of sessionRetryDelaysMs.entries()) {
    await until(() => f.retries().length === index + 1 && f.session.isRetrying);
    assert.equal(f.settings.getRetrySettings, getter, "temporary policy must be restored before sleeping");
    assert.equal(f.settings.getRetrySettings().maxRetries, 3, "summary consumers do not see the session override");
    assert.deepEqual(f.retries()[index], { type: "auto_retry_start", attempt: index + 1, maxAttempts: 9, delayMs: delay, errorMessage: "Request timed out." });
    assert.equal(f.calls(), index + 1);
    t.mock.timers.tick(delay - 1); await turn(); assert.equal(f.calls(), index + 1, "must not retry before its deadline");
    t.mock.timers.tick(1); await until(() => f.calls() === index + 2);
  }
  await run;
  assert.equal(f.calls(), 10); assert.equal(f.retries().length, 9); assert.equal(f.session.isIdle, true);
  assert.deepEqual(f.events.filter(event => event.type === "auto_retry_end"), [{ type: "auto_retry_end", success: false, attempt: 9, finalError: "Request timed out." }]);
  assert.equal(f.events.at(-1)?.type, "agent_settled");
  assert.equal(f.manager.getEntries().filter(entry => entry.type === "context_edit").length, 9, "native failed-attempt projection is retained");
});

test("successful retry resets the next episode to two seconds, including after settings reload", async t => {
  const f = await fixture(t); f.respond(call => response(call % 2 ? "503 service unavailable" : undefined));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (let episode = 0; episode < 2; episode++) {
    if (episode) await f.settings.reload();
    const run = f.session.prompt("OWNED_SUCCESS_QUERY");
    await until(() => f.retries().length === episode + 1 && f.session.isRetrying);
    assert.equal(f.retries().at(-1)!.attempt, 1); assert.equal(f.retries().at(-1)!.delayMs, 2000);
    t.mock.timers.tick(2000); await run; assert.equal(f.session.retryAttempt, 0);
  }
  assert.equal(f.calls(), 4); assert.equal(f.events.filter(event => event.type === "auto_retry_end" && event.success).length, 2);
});

test("thirty-minute native backoff can be stopped immediately without late continuation", async t => {
  const f = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const run = f.session.prompt("OWNED_CANCEL_QUERY");
  for (const [index, delay] of sessionRetryDelaysMs.entries()) {
    await until(() => f.retries().length === index + 1 && f.session.isRetrying);
    if (index < 8) t.mock.timers.tick(delay);
  }
  assert.equal(f.calls(), 9); assert.equal(f.retries().at(-1)!.delayMs, 1_800_000);
  await f.session.abort(); await run;
  assert.equal(f.session.isIdle, true); assert.equal(f.session.retryAttempt, 0);
  assert.ok(f.events.some(event => event.type === "auto_retry_end" && event.finalError === "Retry cancelled"));
  t.mock.timers.tick(1_800_001); await turn(); assert.equal(f.calls(), 9);
});

test("classification, explicit disable/zero budget and custom timing remain native", async t => {
  for (const error of ["401 Unauthorized", "400 invalid argument", "429 insufficient_quota", "503 billing limit exceeded"]) await t.test(error, async t => {
    const f = await fixture(t); f.respond(() => response(error));
    await f.session.prompt("OWNED_NON_RETRYABLE_QUERY"); assert.equal(f.calls(), 1); assert.equal(f.retries().length, 0);
  });
  for (const retry of [{ enabled: false }, { maxRetries: 0 }]) await t.test(JSON.stringify(retry), async t => {
    const f = await fixture(t, { retry });
    await f.session.prompt("OWNED_DISABLED_QUERY"); assert.equal(f.calls(), 1); assert.equal(f.retries().length, 0);
  });
  await t.test("explicit two retries with exponential timing", async t => {
    const f = await fixture(t, { retry: { maxRetries: 2, baseDelayMs: 5, maxAgentDelayMs: 20 } });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const run = f.session.prompt("OWNED_CUSTOM_QUERY");
    for (const [index, delay] of [5, 10].entries()) {
      await until(() => f.retries().length === index + 1 && f.session.isRetrying);
      assert.equal(f.retries()[index].delayMs, delay); assert.equal(f.retries()[index].maxAttempts, 2);
      t.mock.timers.tick(delay);
    }
    await run; assert.equal(f.calls(), 3);
  });
});

test("real native compaction still uses its independent three-attempt exponential retry policy", async t => {
  const f = await fixture(t, { history: true });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const failed = assert.rejects(f.session.compact(), /timed out/);
  for (const [index, delay] of [2000, 4000, 8000].entries()) {
    await until(() => f.events.filter(event => event.type === "summarization_retry_scheduled").length === index + 1);
    const event = f.events.filter(event => event.type === "summarization_retry_scheduled").at(-1)!;
    assert.ok(event.type === "summarization_retry_scheduled");
    assert.equal(event.delayMs, delay); assert.equal(event.maxAttempts, 3);
    // Callback delivery precedes sleep installation in the summarization helper.
    await turn(); t.mock.timers.tick(delay);
  }
  await failed; assert.equal(f.calls(), 4); assert.equal(f.retries().length, 0);
});
