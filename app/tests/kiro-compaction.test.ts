import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type ModelCost, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { createAgentSession, DefaultResourceLoader, findCutPoint, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";
import { installKiroCompactionUsage } from "../src/server/kiro-compaction-usage.js";
import { installNativeCompactionUsage } from "../src/server/native-compaction-usage.js";
import { kiroCompressionProjection, kiroSummaryUsage } from "../src/server/providers/kiro-usage.js";
import { kiroCompactionAttemptKind, kiroUsageInfo } from "../src/shared/kiro-usage.js";
import { usageCost } from "../src/server/usage-cost.js";
import { sumCosts } from "../src/shared/costs.js";
import { applyCompression, captureCompression } from "../src/server/compression-context.js";

const rates = { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 };
const complete = { uncachedInputTokens: 10, outputTokens: 3, cacheReadInputTokens: 2, cacheWriteInputTokens: 1, totalTokens: 16 };
const zeros = { uncachedInputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 0 };

const assistant = (text: string): AssistantMessage => ({
  role: "assistant", content: [{ type: "text", text }], api: "kiro-chat", provider: "kiro", model: "summary-fixture",
  stopReason: "stop", timestamp: 1,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
});

async function fixture(t: TestContext, cost?: ModelCost, externalBilling = true, persist = false, single = false) {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-compaction-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const agentDir = join(root, "pi"); mkdirSync(agentDir);
  const credential: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH",
    expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" };
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => credential);
  await modelsStore.write("kiro", { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] } as ModelsStoreEntry);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{ id: "summary-fixture",
    baseUrl: "https://q.us-east-1.amazonaws.com", contextWindow: 8192, maxTokens: 1024, ...(cost ? { cost } : {}) }] } } }));
  const runtime = await createModelRuntime({ providerIds: ["kiro"], modelsPath, credentials, modelsStore, refreshOnCreate: false });
  assert.equal(runtime.getError(), undefined);
  const model = runtime.getModel("kiro", "summary-fixture")!;
  const manager = persist ? SessionManager.create(root, root) : SessionManager.inMemory(root);
  manager.appendMessage({ role: "user", content: "EARLY_HISTORY", timestamp: 1 });
  manager.appendMessage(assistant("EARLY_REPLY"));
  manager.appendMessage({ role: "user", content: "CURRENT_REQUEST", timestamp: 2 });
  let kept = manager.appendMessage(assistant("LATEST_RETAINED_REPLY".repeat(20))), keepRecentTokens = 1;
  if (single) {
    const entries = manager.getBranch();
    for (; keepRecentTokens <= 2048; keepRecentTokens++) {
      const cut = findCutPoint(entries, 0, entries.length, keepRecentTokens);
      if (!cut.isSplitTurn && cut.firstKeptEntryIndex > 0) { kept = entries[cut.firstKeptEntryIndex].id; break; }
    }
    assert.ok(keepRecentTokens <= 2048, "derive a genuine whole-turn cut using Pi, not guessed token sizes");
  }
  const settingsManager = SettingsManager.inMemory({ cacheWarming: "off",
    compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens },
    retry: { enabled: true, maxRetries: 1, baseDelayMs: 1, maxAgentDelayMs: 1 } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager, noExtensions: true, noSkills: true,
    noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "", appendSystemPrompt: [] });
  await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
    settingsManager, resourceLoader: loader, sessionManager: manager, noTools: "all" });
  t.after(() => session.dispose());
  installKiroCompactionUsage(session, { externalBilling });
  // Match agent-worker's public-instance wrapper order. Scratch's external
  // ledger keeps the generic guard disabled; main sessions install both guards.
  installNativeCompactionUsage(session, { externalBilling });
  const installedStream = session.agent.streamFunction, installedAppend = manager.appendCompaction;
  installKiroCompactionUsage(session, { externalBilling });
  installNativeCompactionUsage(session, { externalBilling });
  assert.equal(session.agent.streamFunction, installedStream); assert.equal(manager.appendCompaction, installedAppend);
  const entries = manager.getBranch();
  const cut = findCutPoint(entries, 0, entries.length, keepRecentTokens);
  assert.equal(cut.isSplitTurn, !single, "fixture uses Pi's real cut, not repeated direct streams");
  assert.equal(entries[cut.firstKeptEntryIndex].id, kept);
  const tickets: string[] = [], requestPrompts: string[] = [], retryEvents: string[] = [];
  const physical: AssistantMessage[] = [], charges: ReturnType<typeof usageCost>[] = [], accounting: Promise<unknown>[] = [];
  const native = runtime.getRegisteredNativeProvider("kiro")!, stream = native.streamSimple.bind(native);
  t.mock.method(native, "streamSimple", (...args: Parameters<typeof native.streamSimple>) => {
    const index = tickets.push(args[2]!.apiKey!) - 1;
    charges[index] = usageCost(null);
    const result = stream(...args);
    assert.equal(typeof result.result, "function", "native stream remains synchronous");
    accounting.push(result.result().then(message => { physical[index] = message; charges[index] = usageCost(message.usage); }));
    return result;
  });
  session.subscribe(event => { if (event.type.startsWith("summarization_retry_")) retryEvents.push(event.type); });
  const install = (respond: (call: number, init?: RequestInit) => Response | Promise<Response>) => {
    t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/", "all traffic is intercepted at the fixed native endpoint");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer FIXTURE-ACCESS");
      const current = JSON.parse(String(init?.body)).conversationState.currentMessage.userInputMessage;
      assert.equal(current.modelId, model.id);
      requestPrompts.push(current.content);
      return respond(requestPrompts.length, init);
    });
  };
  const assertFresh = (count: number) => {
    assert.equal(tickets.length, count);
    assert.equal(new Set(tickets).size, count, "each physical summary attempt has a fresh one-use capability");
    assert.ok(tickets.every(ticket => /^axiom-kiro-native:/.test(ticket)));
    assert.equal(getApiProvider("kiro-chat"), undefined, "no global compat API adapter is registered");
  };
  return { root, model, session, manager, kept, initialLeaf: manager.getLeafEntry()?.id, install, assertFresh, requestPrompts, retryEvents,
    physical, charges, settled: () => Promise.allSettled(accounting), reprice: async (cost: ModelCost) => {
      const configuration = JSON.parse(readFileSync(modelsPath, "utf8"));
      configuration.providers.kiro.models[0].cost = cost; writeFileSync(modelsPath, JSON.stringify(configuration));
      const changed = await createModelRuntime({ providerIds: ["kiro"], modelsPath, credentials, modelsStore, refreshOnCreate: false });
      return changed.getModel("kiro", "summary-fixture")!;
    } };
}

const summary = (text: string, tokenUsage?: unknown) => kiroResponse([kiroFrame("assistantResponseEvent", { content: text }),
  ...(tokenUsage === undefined ? [] : [kiroFrame("metadataEvent", { tokenUsage })])]);

test("AgentSession.compact sends history and split-turn prefix through two freshly authenticated native requests", async t => {
  const f = await fixture(t);
  let now = Date.now();
  t.mock.method(Date, "now", () => now);
  f.install(call => {
    // Cross the one-use handoff TTL between the actual split summary requests,
    // without sleeping or extending its lifetime in production.
    if (call === 1) now += 61_001;
    return summary(call === 1 ? "HISTORY_SUMMARY" : "PREFIX_SUMMARY");
  });
  const result = await f.session.compact("Preserve the authorized goal and boundaries.");
  f.assertFresh(2);
  assert.match(f.requestPrompts[0], /EARLY_HISTORY/);
  assert.doesNotMatch(f.requestPrompts[0], /CURRENT_REQUEST/);
  assert.match(f.requestPrompts[1], /CURRENT_REQUEST/);
  assert.doesNotMatch(f.requestPrompts[1], /LATEST_RETAINED_REPLY/);
  assert.match(result.summary, /HISTORY_SUMMARY[\s\S]*Turn Context \(split turn\)[\s\S]*PREFIX_SUMMARY/);
  assert.equal(result.firstKeptEntryId, f.kept);
  assert.equal(f.manager.getLeafEntry()?.type, "compaction");
  assert.deepEqual(f.retryEvents, []);
});

test("real one-part compact copies its physical usage alias only at persistence, with no duplicate ledger", async t => {
  const f = await fixture(t, rates, false, true, true);
  f.install(() => summary("SINGLE_HISTORY_SUMMARY", complete));
  const result = await f.session.compact(); await f.settled(); f.assertFresh(1);
  assert.equal(result.firstKeptEntryId, f.kept); assert.equal(result.summary, "SINGLE_HISTORY_SUMMARY");
  assert.match(f.requestPrompts[0], /EARLY_HISTORY/); assert.doesNotMatch(f.requestPrompts[0], /CURRENT_REQUEST/);
  assert.equal(result.usage, f.physical[0].usage, "Pi single-summary return aliases its physical result");
  assert.equal(kiroUsageInfo(result.usage)?.scope, "request", "do not relabel that alias in place");
  const reopened = SessionManager.open(f.manager.getSessionFile()!), entry = reopened.getLeafEntry();
  if (entry?.type !== "compaction") throw Error("missing persisted compaction");
  const info = kiroUsageInfo(entry.usage); if (info?.scope !== "summary") throw Error("missing persisted summary marker");
  assert.equal(info.requests.length, 1); assert.notEqual(entry.usage, result.usage);
  assert.equal(reopened.getEntries().some(item => item.type === "usage"), false);
});

test("AgentSession.compact retries a real native HTTP 503 once and then completes both split summaries with fresh tickets", async t => {
  const f = await fixture(t, rates);
  f.install(call => call === 1 ? new Response("fixture unavailable", { status: 503 }) : summary(call === 2 ? "RETRIED_HISTORY" : "PREFIX_SUMMARY", complete));
  const result = await f.session.compact();
  f.assertFresh(3);
  assert.equal(f.requestPrompts[0], f.requestPrompts[1], "retry is Pi's retryAssistantCall for the same summary");
  assert.notEqual(f.requestPrompts[1], f.requestPrompts[2]);
  assert.match(result.summary, /RETRIED_HISTORY[\s\S]*PREFIX_SUMMARY/);
  await f.settled();
  const combined = kiroSummaryUsage(result.usage, f.physical), provenance = kiroUsageInfo(combined), billed = sumCosts(f.charges);
  assert.equal(provenance?.scope, "summary");
  if (provenance?.scope !== "summary") throw Error("missing summary marker");
  assert.equal(provenance.requests.length, 2); assert.equal(provenance.state, "complete");
  assert.equal(billed.records, 3); assert.equal(billed.unknownTokens, 1); assert.equal(billed.unknownCost, 1);
  assert.equal(billed.knownCost, combined.cost.total);
  assert.deepEqual(kiroUsageInfo((f.manager.getLeafEntry() as any).usage), provenance);
  assert.ok(f.physical.every(message => kiroUsageInfo(message.usage)?.scope === "request"), "aggregate does not mutate physical request markers");
  assert.deepEqual(f.retryEvents, ["summarization_retry_scheduled", "summarization_retry_attempt_start", "summarization_retry_finished"]);
  assert.equal(f.manager.getLeafEntry()?.type, "compaction");
});

test("AgentSession.compact does not retry native authentication failure or commit a failed checkpoint", async t => {
  const f = await fixture(t);
  f.install(() => new Response("fixture unauthorized", { status: 401 }));
  await assert.rejects(f.session.compact(), /认证/);
  f.assertFresh(1);
  assert.deepEqual(f.retryEvents, []);
  assert.equal(f.manager.getLeafEntry()?.id, f.initialLeaf, "SDK initialization metadata remains the original leaf");
  assert.equal(f.manager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("AgentSession.compact aborts a signal-ignoring native transport without retry or a committed checkpoint", async t => {
  const f = await fixture(t);
  f.install(() => {
    queueMicrotask(() => f.session.abortCompaction());
    return new Promise<Response>(() => {});
  });
  await assert.rejects(f.session.compact(), /abort|cancel|取消/i);
  f.assertFresh(1);
  assert.deepEqual(f.retryEvents, []);
  assert.equal(f.manager.getLeafEntry()?.id, f.initialLeaf, "SDK initialization metadata remains the original leaf");
  assert.equal(f.manager.getEntries().some(entry => entry.type === "compaction"), false);
});

test("native split-summary metadata survives the actual before-append boundary, outgoing projection, apply-once and SDK reopen without repricing", async t => {
  const f = await fixture(t, { ...rates, tiers: [{ inputTokensAbove: 100, input: 20, output: 80, cacheRead: 5, cacheWrite: 30 }] });
  const snapshot = captureCompression(f.manager), file = join(f.root, "owner.jsonl");
  writeFileSync(file, [snapshot.header, ...snapshot.entries].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  const owner = SessionManager.open(file);
  f.install(call => summary(`SUMMARY_${call}`, { ...complete, uncachedInputTokens: call === 1 ? 100 : 101,
    outputTokens: 2, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: call === 1 ? 102 : 103 }));
  const result = await f.session.compact(); await f.settled(); f.assertFresh(2);
  const entry = f.manager.getLeafEntry();
  assert.equal(entry?.type, "compaction");
  if (entry?.type !== "compaction") throw Error("missing compaction");
  const info = kiroUsageInfo(entry.usage);
  assert.equal(info?.scope, "summary");
  if (info?.scope !== "summary") throw Error("missing persisted summary marker");
  assert.equal(info.state, "complete"); assert.equal(info.pricing.kind, "configured-estimate");
  assert.deepEqual(info.requests.map(request => request.pricing.inputTokensAbove), [undefined, 100]);
  assert.equal(entry.usage?.input, 201); assert.equal(entry.usage?.totalTokens, 205);
  assert.equal(entry.usage?.cost.total, f.physical.reduce((sum, message) => sum + message.usage.cost.total, 0));
  assert.notEqual(entry.usage?.cost.input, (20 / 1e6) * 201, "do not apply a single tier to combined requests");
  assert.equal(kiroUsageInfo(result.usage), undefined, "Pi's public combined return is not mutated to repair persistence");
  assert.ok(f.physical.every(message => kiroUsageInfo(message.usage)?.scope === "request"));
  const outgoing = kiroSummaryUsage(result.usage, f.physical), projection = kiroCompressionProjection(outgoing);
  assert.equal(projection.cost, entry.usage?.cost.total); assert.equal(projection.cacheRead, 0); assert.equal(projection.cacheWrite, 0);
  const before = JSON.stringify(entry.usage);
  assert.equal(applyCompression(owner, snapshot, { ...entry, usage: outgoing }, "fixture-compression"), true);
  assert.equal(applyCompression(owner, snapshot, { ...entry, usage: outgoing }, "fixture-compression"), false);
  const editedRates = structuredClone(f.model.cost); editedRates.input = 999; editedRates.tiers![0].input = 999;
  assert.equal((await f.reprice(editedRates)).cost.input, 999, "a newly loaded native model observes the edited price");
  const reopened = SessionManager.open(file), applied = reopened.getBranch().filter(item => item.type === "compaction");
  assert.equal(applied.length, 1); assert.equal(JSON.stringify(applied[0].usage), before, "persisted historical prices and costs do not follow live edits");
  assert.deepEqual(kiroUsageInfo(applied[0].usage), info);
});

test("real split summaries keep unknown and partial distinct from measured zero", async t => {
  for (const variant of ["missing", "partial", "zero"] as const) await t.test(variant, async t => {
    const f = await fixture(t, rates);
    f.install(call => variant === "partial" ? kiroResponse([kiroFrame("assistantResponseEvent", { content: `SUMMARY_${call}` }),
      kiroFrame("metadataEvent", { tokenUsage: complete }), ...(call === 1 ? [kiroFrame("metadataEvent", { tokenUsage: {} })] : [])])
      : summary(`SUMMARY_${call}`, variant === "zero" ? zeros : undefined));
    await f.session.compact(); await f.settled(); f.assertFresh(2);
    const entry = f.manager.getLeafEntry();
    if (entry?.type !== "compaction" || !entry.usage) throw Error("missing compaction");
    const info = kiroUsageInfo(entry.usage);
    assert.equal(info?.scope, "summary");
    if (info?.scope !== "summary") throw Error("missing summary marker");
    assert.equal(info.requests.length, 2);
    assert.equal(info.state, variant === "missing" ? "unknown" : variant === "partial" ? "partial" : "complete");
    assert.equal(info.pricing.kind, variant === "zero" ? "configured-estimate" : "unknown");
    const projection = kiroCompressionProjection(kiroSummaryUsage(entry.usage, f.physical)), billed = sumCosts(f.charges);
    assert.equal(projection.cost, variant === "zero" ? 0 : null);
    assert.equal(billed.unknownTokens, variant === "zero" ? 0 : variant === "partial" ? 1 : 2);
    assert.equal(billed.unknownCost, variant === "zero" ? 0 : variant === "partial" ? 1 : 2);
    if (variant === "zero") assert.deepEqual([projection.input, projection.output, projection.cacheRead, projection.cacheWrite, projection.total], [0, 0, 0, 0, 0]);
  });
});

test("a failed second summary is physically billed but not committed or mixed into a later compact generation", async t => {
  const f = await fixture(t, rates);
  f.install(call => call === 1 ? summary("FIRST_GENERATION_HISTORY", complete) : new Response("fixture unauthorized", { status: 401 }));
  await assert.rejects(f.session.compact(), /认证/); await f.settled();
  assert.equal(f.manager.getEntries().some(entry => entry.type === "compaction"), false);
  assert.equal(f.manager.getLeafEntry()?.id, f.initialLeaf);
  assert.equal(sumCosts(f.charges).records, 2); assert.equal(sumCosts(f.charges).unknownCost, 1);
  f.install(call => summary(`RECOVERY_${call}`, complete));
  await f.session.compact(); await f.settled(); f.assertFresh(4);
  const entry = f.manager.getLeafEntry();
  if (entry?.type !== "compaction") throw Error("missing recovered compaction");
  const info = kiroUsageInfo(entry.usage);
  if (info?.scope !== "summary") throw Error("missing summary marker");
  assert.equal(info.requests.length, 2, "failed generation's successful history is not reused");
  assert.equal(entry.usage?.totalTokens, complete.totalTokens * 2);
  assert.equal(sumCosts(f.charges).records, 4); assert.equal(sumCosts(f.charges).unknownCost, 1);
  assert.equal(f.manager.getEntries().filter(entry => entry.type === "compaction").length, 1);
});

test("native compaction's own durable ledger adds only attempts excluded from the successful checkpoint", async t => {
  for (const retry of [false, true]) await t.test(retry ? "503 retry" : "no retries", async t => {
    const f = await fixture(t, rates, false, true);
    f.install(call => retry && call === 1 ? new Response("fixture unavailable", { status: 503 }) : summary(`SUMMARY_${call}`, complete));
    await f.session.compact(); await f.settled(); f.assertFresh(retry ? 3 : 2);
    const reopened = SessionManager.open(f.manager.getSessionFile()!);
    const attempts = reopened.getEntries().filter((entry): entry is Extract<typeof entry, { type: "usage" }> => entry.type === "usage" && entry.kind === kiroCompactionAttemptKind);
    assert.equal(attempts.length, retry ? 1 : 0, "successful summary requests are not appended again as usage");
    assert.equal(reopened.getEntries().filter(entry => entry.type === "usage").length, attempts.length,
      "the generic guard must not add a second Kiro billing namespace");
    const checkpoint = reopened.getEntries().find(entry => entry.type === "compaction");
    if (checkpoint?.type !== "compaction") throw Error("missing checkpoint");
    const info = kiroUsageInfo(checkpoint.usage);
    if (info?.scope !== "summary") throw Error("missing provenance");
    assert.equal(info.requests.length, 2);
    const actual = sumCosts([usageCost(checkpoint.usage), ...attempts.map(entry => usageCost(entry.usage))]), expected = sumCosts(f.charges);
    assert.equal(actual.knownCost, expected.knownCost); assert.equal(actual.unknownCost, expected.unknownCost);
    assert.deepEqual(actual.tokens, expected.tokens); assert.deepEqual(actual.parts, expected.parts);
    assert.ok(attempts.every(entry => kiroUsageInfo(entry.usage)?.scope === "request"));
  });
});

test("real SDK repeats automatic threshold and usage-based overflow compaction without retrying completed replies", async t => {
  for (const reason of ["threshold", "overflow"] as const) await t.test(reason, async t => {
    const f = await fixture(t, rates, false, true);
    f.session.setAutoCompactionEnabled(true);
    let summarizing = false, normalCalls = 0;
    const starts: string[] = [], ends: { reason: string; aborted: boolean; willRetry: boolean; hasResult: boolean }[] = [];
    f.session.subscribe(event => {
      if (event.type === "compaction_start") { summarizing = true; starts.push(event.reason); }
      if (event.type === "compaction_end") {
        summarizing = false; ends.push({ reason: event.reason, aborted: event.aborted, willRetry: event.willRetry, hasResult: !!event.result });
      }
    });
    const input = reason === "overflow" ? 8300 : 7800;
    f.install(call => summarizing ? summary(`AUTO_SUMMARY_${call}`, complete)
      : summary(`OWNED_COMPLETED_REPLY_${++normalCalls}`, { ...complete, uncachedInputTokens: input, totalTokens: input + 6 }));
    for (let round = 1; round <= 2; round++) {
      // Journal timestamps use wall-clock Date, so do not fake Date.now alone.
      // A fresh response must be newer than the preceding compaction boundary.
      if (round === 2) await new Promise(resolve => setTimeout(resolve, 2));
      await f.session.prompt(`OWNED_AUTO_REQUEST_${round}`); await f.settled();
      assert.equal(normalCalls, round, "successful overflow compacts without replaying the completed business response");
      assert.equal(starts.length, round); assert.equal(ends.length, round);
    }
    f.assertFresh(6); assert.deepEqual(starts, [reason, reason]); assert.deepEqual(f.retryEvents, []);
    assert.ok(ends.every(event => event.reason === reason && !event.aborted && !event.willRetry && event.hasResult));
    const entries = SessionManager.open(f.manager.getSessionFile()!).getEntries();
    const checkpoints = entries.filter(entry => entry.type === "compaction"); assert.equal(checkpoints.length, 2);
    for (const entry of checkpoints) {
      const info = kiroUsageInfo(entry.usage); if (info?.scope !== "summary") throw Error("missing automatic summary marker");
      assert.equal(info.requests.length, 2); assert.equal(info.state, "complete");
    }
    const replies = entries.filter((entry): entry is Extract<typeof entry, { type: "message" }> =>
      entry.type === "message" && entry.message.role === "assistant" && entry.message.timestamp > 1);
    assert.equal(replies.length, 2); assert.equal(entries.some(entry => entry.type === "context_edit"), false);
    assert.equal(entries.some(entry => entry.type === "usage"), false,
      "neither billing guard appends duplicate charges for successful automatic Kiro summaries");
    const recorded = sumCosts([...checkpoints.map(entry => usageCost(entry.usage)), ...replies.map(entry =>
      usageCost(entry.message.role === "assistant" ? entry.message.usage : null))]);
    const physical = sumCosts(f.charges);
    assert.ok(Math.abs(recorded.knownCost - physical.knownCost) < 1e-12, "checkpoint grouping changes addition order, not request-time prices");
    assert.deepEqual(recorded.tokens, physical.tokens);
    assert.equal(recorded.unknownTokens, 0); assert.equal(recorded.unknownCost, 0);
    assert.ok(f.physical.every(message => kiroUsageInfo(message.usage)?.scope === "request"));
  });
});

test("native ledger persists every uncommitted physical summary on failure or cancellation", async t => {
  for (const cancel of [false, true]) await t.test(cancel ? "cancel" : "second summary fails", async t => {
    const f = await fixture(t, rates, false, true);
    f.install(call => {
      if (!cancel && call === 1) return summary("UNCOMMITTED_HISTORY", complete);
      if (!cancel) return new Response("fixture unauthorized", { status: 401 });
      queueMicrotask(() => f.session.abortCompaction()); return new Promise<Response>(() => {});
    });
    await assert.rejects(f.session.compact(), /认证|abort|cancel|取消/i); await f.settled();
    const reopened = SessionManager.open(f.manager.getSessionFile()!);
    assert.equal(reopened.getEntries().some(entry => entry.type === "compaction"), false);
    const attempts = reopened.getEntries().filter((entry): entry is Extract<typeof entry, { type: "usage" }> => entry.type === "usage" && entry.kind === kiroCompactionAttemptKind);
    assert.equal(attempts.length, cancel ? 1 : 2);
    assert.equal(reopened.getEntries().filter(entry => entry.type === "usage").length, attempts.length,
      "failure and cancellation remain owned only by Kiro's physical-attempt ledger");
    const actual = sumCosts(attempts.map(entry => usageCost(entry.usage))), expected = sumCosts(f.charges);
    assert.deepEqual(actual, expected);
    assert.equal(actual.unknownCost, 1); assert.equal(actual.unknownTokens, 1);
    assert.equal(f.session.messages.length, 4, "usage ledger entries never add LLM-visible messages");
  });
});
