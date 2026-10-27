import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, findCutPoint, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { installKiroCompactionUsage } from "../src/server/kiro-compaction-usage.js";
import { installNativeCompactionUsage, nativeCompactionCost } from "../src/server/native-compaction-usage.js";
import { nativeCompactionAttemptKind, sumCosts } from "../src/shared/costs.js";
import { usageCost } from "../src/server/usage-cost.js";

function response(stopReason: AssistantMessage["stopReason"] = "stop", amount = .1): AssistantMessage {
  return { role: "assistant", api: "openai-completions", provider: "openai", model: "summary-fixture", timestamp: 1,
    content: [{ type: "text", text: "SUMMARY" }], stopReason,
    ...(stopReason === "error" ? { errorMessage: "terminated" } : {}),
    usage: { input: 10, output: 3, cacheRead: 2, cacheWrite: 1, totalTokens: 16,
      cost: { input: amount / 2, output: amount / 4, cacheRead: amount / 8, cacheWrite: amount / 8, total: amount } } };
}
async function fixture(t: TestContext, outputs: (AssistantMessage | Error)[], single = false, externalBilling = false, asynchronous = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-native-accounting-")), agentDir = join(root, "pi"); mkdirSync(agentDir);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { openai: { api: "openai-completions", baseUrl: "https://fixture.invalid/v1", models: [{ id: "summary-fixture", contextWindow: 8192, maxTokens: 1024 }] } } }));
  const credentials = new InMemoryCredentialStore(); await credentials.modify("openai", async () => ({ type: "api_key", key: "FIXTURE" }));
  const runtime = await createModelRuntime({ providerIds: ["openai"], modelsPath, credentials, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
  const model = runtime.getModel("openai", "summary-fixture")!;
  const manager = SessionManager.inMemory(root);
  manager.appendMessage({ role: "user", content: "EARLY_HISTORY", timestamp: 1 }); manager.appendMessage(response());
  manager.appendMessage({ role: "user", content: "CURRENT_REQUEST", timestamp: 2 });
  manager.appendMessage({ ...response(), content: [{ type: "text", text: "LATEST_RETAINED_REPLY".repeat(20) }] });
  let keepRecentTokens = 1;
  if (single) for (; keepRecentTokens <= 2048; keepRecentTokens++) {
    const cut = findCutPoint(manager.getBranch(), 0, manager.getBranch().length, keepRecentTokens);
    if (!cut.isSplitTurn && cut.firstKeptEntryIndex > 0) break;
  }
  assert.equal(findCutPoint(manager.getBranch(), 0, manager.getBranch().length, keepRecentTokens).isSplitTurn, !single);
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off", compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens }, retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "", appendSystemPrompt: [] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "off", settingsManager, resourceLoader: loader, sessionManager: manager, noTools: "all" });
  t.after(() => session.dispose());
  let invocations = 0;
  session.agent.streamFunction = () => {
    const output = outputs[invocations++];
    if (!output) throw Error("Unexpected request");
    const result = { result: () => output instanceof Error ? Promise.reject(output) : Promise.resolve(output) } as Awaited<ReturnType<typeof session.agent.streamFunction>>;
    return asynchronous ? Promise.resolve(result) : result;
  };
  installKiroCompactionUsage(session, { externalBilling }); installNativeCompactionUsage(session, { externalBilling });
  const installed = session.agent.streamFunction;
  installNativeCompactionUsage(session, { externalBilling }); assert.equal(session.agent.streamFunction, installed);
  const attempts = () => manager.getEntries().filter(e => e.type === "usage" && e.kind === nativeCompactionAttemptKind);
  const checkpoints = () => manager.getEntries().filter(e => e.type === "compaction");
  const totals = () => sumCosts(manager.getEntries().flatMap(e => (e.type === "compaction" || e.type === "usage") ? [usageCost(e.usage)] : []));
  return { session, manager, attempts, checkpoints, totals, calls: () => invocations };
}

test("real native single/split compactions are not charged twice, sync and async streams", async t => {
  for (const single of [false, true]) for (const asynchronous of [false, true]) await t.test(`${single}/${asynchronous}`, async t => {
    const f = await fixture(t, [response(), response()], single, false, asynchronous);
    await f.session.compact();
    assert.equal(f.calls(), single ? 1 : 2); assert.equal(f.checkpoints().length, 1); assert.equal(f.attempts().length, 0);
    assert.equal(f.totals().knownCost, single ? .1 : .2);
  });
});

test("native retry keeps the failed billed attempt outside the successful checkpoint", async t => {
  const f = await fixture(t, [response("error", .03), response("stop", .1)], true);
  await f.session.compact();
  assert.equal(f.calls(), 2); assert.equal(f.checkpoints().length, 1); assert.equal(f.attempts().length, 1);
  assert.equal(f.totals().knownCost, .13); assert.equal(f.totals().tokens.input, 20);
});

test("split first-success/second-failure retains both physical attempts without a checkpoint", async t => {
  const failed = response("error", .02); failed.errorMessage = "Unauthorized";
  const f = await fixture(t, [response(), failed]);
  await assert.rejects(f.session.compact());
  assert.equal(f.calls(), 2); assert.equal(f.checkpoints().length, 0); assert.equal(f.attempts().length, 2);
  assert.ok(Math.abs(f.totals().knownCost - .12) < 1e-12);
});

test("transport result rejection remains unknown instead of fabricated zero consumption", async t => {
  const f = await fixture(t, [Error("Unauthorized")], true);
  await assert.rejects(f.session.compact());
  assert.equal(f.calls(), 1); assert.equal(f.attempts().length, 1); assert.equal(f.totals().unknownCost, 1);
  assert.equal(f.totals().unknownTokens, 1); assert.equal(f.totals().knownCost, 0);
});

test("external worker ledger owns all native charges when externalBilling is enabled", async t => {
  const f = await fixture(t, [response(), response()], false, true);
  await f.session.compact(); assert.equal(f.attempts().length, 0); assert.equal(f.checkpoints().length, 1);
});

test("native checkpoints retain per-request model attribution for public estimates and context tiers", async t => {
  for (const single of [true, false]) await t.test(String(single), async t => {
    const message = { ...response("stop", 0), model: single ? "glm-5.3" : "gemini-2.5-pro",
      usage: { ...response("stop", 0).usage, input: single ? 1_000_000 : 150_000, output: single ? 100_000 : 1000, cacheRead: single ? 2_000_000 : 0, cacheWrite: 0, totalTokens: single ? 3_100_000 : 151_000 } };
    const f = await fixture(t, [message, structuredClone(message)], single);
    await f.session.compact();
    assert.equal(f.attempts().length, 0);
    const checkpoint = f.checkpoints()[0], bill = nativeCompactionCost(checkpoint.usage, checkpoint.details);
    assert.equal(bill.model, message.model); assert.equal(bill.totals.estimatedRecords, single ? 1 : 2);
    assert.ok(Math.abs(bill.totals.knownCost - (single ? 2.36 : .395)) < 1e-10);
    assert.equal(nativeCompactionCost(checkpoint.usage, { axiomNativeCompaction: { version: 1, calls: [{ provider: "openai", model: "glm-5.3", usage: response().usage }] } }).totals.unknownCost, 1, "mismatched metadata must not guess a price");
  });
});

test("mixed recorded and unpriced split requests preserve the recorded amount and do not conceal missing charges", async t => {
  for (const model of ["gemini-2.5-pro", "unknown-model"]) await t.test(model, async t => {
    const recorded = { ...response("stop", .7), model: "gemini-2.5-pro", usage: { input: 150_000, output: 1000, cacheRead: 0, cacheWrite: 0, totalTokens: 151_000,
      cost: { input: .5, output: .2, cacheRead: 0, cacheWrite: 0, total: .7 } } };
    const unpriced = { ...recorded, model, usage: { ...recorded.usage, cost: response("stop", 0).usage.cost } };
    const f = await fixture(t, [recorded, unpriced]); await f.session.compact();
    const checkpoint = f.checkpoints()[0], bill = nativeCompactionCost(checkpoint.usage, checkpoint.details);
    assert.equal(checkpoint.usage?.cost.total, .7, "checkpoint and recorded per-request charges are never rewritten");
    assert.equal(f.attempts().length, 0); assert.equal(bill.totals.records, 2);
    if (model === "gemini-2.5-pro") {
      assert.ok(Math.abs(bill.totals.knownCost - .8975) < 1e-10);
      assert.equal(bill.totals.estimatedRecords, 1); assert.equal(bill.totals.unknownCost, 0);
    } else {
      assert.equal(bill.totals.knownCost, .7); assert.equal(bill.totals.unknownCost, 1);
      assert.equal(bill.model, undefined, "mixed model IDs must not be labelled as one model");
    }
  });
});

test("custom checkpoints stay ambiguous; committed native checkpoints remain covered without an end result", async t => {
  for (const fromHook of [true, false]) await t.test(String(fromHook), async () => {
    let listener: (event: any) => void = () => {};
    const manager = SessionManager.inMemory(tmpdir()), message = response();
    const session = { sessionManager: manager, agent: { streamFunction: () => ({ result: () => Promise.resolve(message) }) }, subscribe(fn: typeof listener) { listener = fn; } } as any;
    installNativeCompactionUsage(session); listener({ type: "compaction_start" });
    await session.agent.streamFunction({ provider: "openai", id: "fixture", api: "openai-completions" }).result();
    manager.appendCompaction("SUMMARY", null, 100, { preserved: true }, fromHook, message.usage);
    listener({ type: "compaction_end", error: "after hook failed" });
    const attempts = manager.getEntries().filter(e => e.type === "usage");
    assert.equal(attempts.length, fromHook ? 1 : 0);
    if (attempts[0]) { assert.equal(usageCost(attempts[0].usage).unknownTokens, 1); assert.equal(usageCost(attempts[0].usage).knownCost, 0); }
    const checkpoint = manager.getEntries().find(e => e.type === "compaction")!;
    assert.equal((checkpoint.details as any).preserved, true);
  });
});

test("throwing streams remain unknown while Kiro and pre-aborted calls pass through", () => {
  for (const mode of ["throw", "kiro", "aborted"]) {
    let listener: (event: any) => void = () => {};
    const manager = SessionManager.inMemory(tmpdir());
    const session = { sessionManager: manager, agent: { streamFunction: () => { throw Error("Unauthorized"); } }, subscribe(fn: typeof listener) { listener = fn; } } as any;
    installNativeCompactionUsage(session); listener({ type: "compaction_start" });
    assert.throws(() => session.agent.streamFunction({ provider: "fixture", id: "fixture", api: mode === "kiro" ? "kiro-chat" : "openai-completions" }, {}, { signal: { aborted: mode === "aborted" } }));
    listener({ type: "compaction_end" });
    const attempts = manager.getEntries().filter(e => e.type === "usage");
    assert.equal(attempts.length, mode === "throw" ? 1 : 0);
    if (attempts[0]) assert.equal(usageCost(attempts[0].usage).unknownTokens, 1);
  }
});

// Public-instance edge cases without a second SDK runtime.
test("result observation is memoized and late generations cannot rewrite persisted unknown attempts", async () => {
  let listener: (event: any) => void = () => {}, done!: (value: AssistantMessage) => void;
  const manager = SessionManager.inMemory(tmpdir()), pending = new Promise<AssistantMessage>(resolve => { done = resolve; });
  let reads = 0;
  const output = { result: () => { reads++; return pending; } };
  const session = { sessionManager: manager, agent: { streamFunction: () => output }, subscribe(fn: typeof listener) { listener = fn; } } as any;
  installNativeCompactionUsage(session);
  listener({ type: "compaction_start" });
  const result = session.agent.streamFunction({ provider: "openai", id: "fixture", api: "openai-completions" }).result();
  // Calling result repeatedly must not observe the same physical response twice.
  assert.equal(output.result(), result); assert.equal(reads, 1);
  listener({ type: "compaction_end" });
  const before = JSON.stringify(manager.getEntries()); done(response()); await result;
  assert.equal(JSON.stringify(manager.getEntries()), before);
  const entry = manager.getEntries()[0]; if (entry.type !== "usage") throw Error("Missing unknown attempt");
  assert.equal(usageCost(entry.usage).unknownTokens, 1);
});
