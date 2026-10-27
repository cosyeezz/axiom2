import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calculateCost, InMemoryCredentialStore, InMemoryModelsStore, normalizeContext, type AssistantMessage, type Model, type ModelCost, type ModelsStoreEntry, type StreamOptions } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { kiroChat } from "../src/server/providers/kiro-chat.js";
import { kiroOAuth, type KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import { kiroCompressionProjection, kiroRequestUsage, kiroSummaryUsage } from "../src/server/providers/kiro-usage.js";
import { kiroCompactionAttemptKind, kiroUsageInfo } from "../src/shared/kiro-usage.js";
import { usageCost } from "../src/server/usage-cost.js";
import { lastRequestUsage } from "../src/server/request-usage.js";
import { agentSessionUsage } from "../src/server/agent-session-usage.js";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { Store } from "../src/server/storage.js";
import { ProcessingRecords } from "../src/server/processing-records.js";
import { TaskRecords } from "../src/server/tasks/records.js";
import { Costs } from "../src/server/costs.js";
import type { Compression } from "../src/shared/compression.js";
import type { ProcessingRecord } from "../src/shared/processing.js";
import type { Session, Workspace } from "../src/shared/protocol.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const zeroRates = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const prices = { input: 2, output: 8, cacheRead: .5, cacheWrite: 3 };
const full = { uncachedInputTokens: 10, outputTokens: 3, cacheReadInputTokens: 2, cacheWriteInputTokens: 1, totalTokens: 16 };
const zero = { uncachedInputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 0 };
const account = (): KiroCredential => ({ type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" });
const model = (cost: ModelCost = zeroRates): Model<"kiro-chat"> => ({ api: "kiro-chat", provider: "kiro", id: "usage-fixture", name: "usage fixture", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text"], reasoning: false, contextWindow: 32_768, maxTokens: 1024, cost: structuredClone(cost) });
const context = () => normalizeContext({ messages: [{ role: "user", content: "Owned fixture input", timestamp: 1 }] });
const metadata = (tokenUsage: unknown) => kiroFrame("metadataEvent", { tokenUsage });
const text = () => kiroFrame("assistantResponseEvent", { content: "SAFE_FIXTURE_REPLY" });
async function native(frames: Uint8Array[], cost: ModelCost = zeroRates, options: StreamOptions = {}) {
  const chat = kiroChat(kiroOAuth()), auth = await chat.auth.toAuth(account());
  return chat.stream(model(cost), context(), { ...options, apiKey: auth.apiKey, fetch: async url => {
    assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/"); return kiroResponse(frames);
  } }).result();
}
const state = (message: AssistantMessage) => kiroUsageInfo(message.usage)?.state;

test("native usage distinguishes absent, partial, measured zero and configured estimate", async t => {
  const cases = [
    { name: "missing", frames: [text()], state: "unknown", tokensUnknown: 1, price: zeroRates, costUnknown: 1 },
    { name: "credits and percentage are not tokens or USD", frames: [text(), kiroFrame("meteringEvent", { usage: 3, unit: "credits" }), kiroFrame("contextUsageEvent", { contextUsagePercentage: 70 })], state: "unknown", tokensUnknown: 1, price: prices, costUnknown: 1 },
    { name: "empty snapshot", frames: [text(), metadata({})], state: "partial", tokensUnknown: 1, price: prices, costUnknown: 1 },
    { name: "one counter is not a full snapshot", frames: [text(), metadata({ outputTokens: 2 })], state: "partial", tokensUnknown: 1, price: prices, costUnknown: 1 },
    { name: "default zero rates are unknown pricing", frames: [text(), metadata(zero)], state: "complete", tokensUnknown: 0, price: zeroRates, costUnknown: 1 },
    { name: "measured zero with configured positive rates", frames: [text(), metadata(zero)], state: "complete", tokensUnknown: 0, price: prices, costUnknown: 0 },
    { name: "complete positive count", frames: [text(), metadata(full)], state: "complete", tokensUnknown: 0, price: prices, costUnknown: 0 },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const message = await native(c.frames, c.price), totals = usageCost(message.usage);
    assert.equal(message.stopReason, "stop", message.errorMessage); assert.equal(state(message), c.state);
    assert.equal(totals.unknownTokens, c.tokensUnknown); assert.equal(totals.unknownCost, c.costUnknown);
    const serialized = JSON.parse(JSON.stringify(message));
    assert.deepEqual(kiroUsageInfo(serialized.usage), kiroUsageInfo(message.usage));
    if (c.name === "measured zero with configured positive rates") {
      assert.equal(message.usage.totalTokens, 0); assert.equal(totals.knownCost, 0); assert.equal(totals.unknownParts, 0);
    }
  });
});

test("complete then partial preserves prior numbers but loses current completeness, later full recovers", async () => {
  for (const partial of [{}, { outputTokens: 5 }, { uncachedInputTokens: 99, totalTokens: 100 }]) {
    const message = await native([text(), metadata(full), metadata(partial)], prices);
    assert.equal(state(message), "partial"); assert.equal(message.usage.input, 10); assert.equal(message.usage.output, 3);
    assert.equal(message.usage.totalTokens, 16); assert.equal(usageCost(message.usage).unknownTokens, 1);
    assert.equal(usageCost(message.usage).unknownCost, 1); // Old estimate isn't the final current price.
  }
  const restored = await native([text(), metadata(full), metadata({ outputTokens: 99 }), metadata(zero)], prices);
  assert.equal(state(restored), "complete"); assert.equal(restored.usage.input, 0); assert.equal(restored.usage.cost.total, 0);
  const broken = await native([text(), metadata(full), metadata({ ...full, uncachedInputTokens: 100, totalTokens: 1 })], prices);
  assert.equal(broken.stopReason, "error"); assert.equal(state(broken), "partial");
  assert.equal(broken.usage.input, 10, "invalid totals cannot half-publish new input"); assert.equal(broken.usage.totalTokens, 16);
  const invalid = { ...structuredClone(restored.usage), axiomKiro: { version: 99 } };
  assert.equal(usageCost(invalid).unknownTokens, 1); assert.equal(usageCost(invalid).unknownCost, 1);
});

test("native null measurement cannot retain a stale complete snapshot", async () => {
  const message = await native([text(), metadata(full), metadata(null)], prices);
  assert.equal(message.stopReason, "error"); assert.equal(state(message), "partial");
  assert.equal(message.usage.input, 10); assert.equal(message.usage.totalTokens, 16);
  assert.equal(usageCost(message.usage).unknownTokens, 1); assert.equal(usageCost(message.usage).unknownCost, 1);
});

test("usage marker survives error and cancellation, without executing or retrying anything", async () => {
  const failed = await native([text(), metadata(full), metadata({}), Buffer.alloc(3)], prices);
  assert.equal(failed.stopReason, "error"); assert.equal(state(failed), "partial"); assert.equal(failed.usage.totalTokens, 16);
  const abort = new AbortController();
  const cancelled = await native([text(), metadata(full), metadata({}), kiroFrame("meteringEvent", { usage: 1 })], prices, {
    signal: abort.signal, onProviderStreamEvent: event => {
      if ((event as { headers: Record<string, string> }).headers[":event-type"] === "meteringEvent") abort.abort();
    },
  });
  assert.equal(cancelled.stopReason, "aborted"); assert.equal(state(cancelled), "partial"); assert.equal(cancelled.usage.totalTokens, 16);
  const early = new AbortController(); early.abort();
  const untouched = await native([text(), metadata(full)], prices, { signal: early.signal });
  assert.equal(untouched.stopReason, "aborted"); assert.equal(state(untouched), "unknown");
});

test("request-time rates and tiers are deep snapshots; report reads never reprice", async () => {
  const cost: ModelCost = { ...prices, tiers: [{ inputTokensAbove: 100, input: 4, output: 16, cacheRead: 1, cacheWrite: 6 }] };
  const target = model(cost), captured = structuredClone(target.cost), chat = kiroChat(kiroOAuth());
  const auth = await chat.auth.toAuth(account());
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const tokenUsage = { uncachedInputTokens: 101, outputTokens: 2, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 103 };
  const stream = chat.stream(target, context(), { apiKey: auth.apiKey, fetch: async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; }); return kiroResponse([text(), metadata(tokenUsage)]);
  } });
  await started; target.cost.input = 999; target.cost.tiers![0].input = 999; target.cost.tiers!.push({ ...prices, inputTokensAbove: 0 });
  release(); const message = await stream.result(), info = kiroUsageInfo(message.usage);
  assert.equal(info?.scope, "request");
  if (info?.scope !== "request") throw Error("missing request provenance");
  assert.deepEqual(info.pricing.rates, captured); assert.equal(info.pricing.inputTokensAbove, 100);
  const expected = structuredClone(message.usage); calculateCost({ ...target, cost: captured }, expected);
  assert.deepEqual(message.usage.cost, expected.cost); assert.equal(usageCost(message.usage).knownCost, expected.cost.total);
  const before = JSON.stringify(message.usage); target.cost.output = 1234; usageCost(message.usage); assert.equal(JSON.stringify(message.usage), before);
  const edge = kiroRequestUsage(model(cost));
  edge.accept({ ...tokenUsage, uncachedInputTokens: 100, totalTokens: 102 });
  const edgeInfo = kiroUsageInfo(edge.usage);
  assert.equal(edgeInfo?.scope === "request" ? edgeInfo.pricing.inputTokensAbove : "bad", undefined, "tier boundary is strictly greater, like SDK");
  assert.equal(edge.usage.cost.input, (prices.input / 1_000_000) * 100);
  const huge = kiroRequestUsage(model({ input: Number.MAX_VALUE, output: 1, cacheRead: 1, cacheWrite: 1 }));
  huge.accept({ uncachedInputTokens: 1_000_000_000, outputTokens: 0, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 1_000_000_000 });
  assert.equal(usageCost(huge.usage).unknownCost, 1); assert.ok(Number.isFinite(huge.usage.cost.total));
});

test("latest incomplete or unsupported attempt cannot backfill an earlier cache reading", async () => {
  const manager = SessionManager.inMemory(), exact = await native([text(), metadata(full)], prices);
  manager.appendMessage(exact); assert.deepEqual(lastRequestUsage(manager), { input: 10, cacheRead: 2, cacheWrite: 1 });
  const partial = await native([text(), metadata(full), metadata({})], prices);
  const entry = manager.appendMessage({ ...partial, stopReason: "error" }); manager.appendContextEdit(entry, null);
  assert.equal(lastRequestUsage(manager), null);
  manager.appendMessage(await native([text(), metadata(zero)], prices));
  assert.deepEqual(lastRequestUsage(manager), { input: 0, cacheRead: 0, cacheWrite: 0 });
  manager.appendMessage({ ...exact, usage: { ...exact.usage, axiomKiro: { version: 99 } } } as AssistantMessage);
  assert.equal(lastRequestUsage(manager), null);
});

async function sdk(t: TestContext, reported: unknown | undefined) {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-usage-sdk-")), pi = join(root, "pi"); mkdirSync(pi);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore(), credential = account();
  await credentials.modify("kiro", async () => credential);
  await modelsStore.write("kiro", { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] } as ModelsStoreEntry);
  const path = join(root, "models.json"); writeFileSync(path, JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{ id: "usage-fixture", baseUrl: model().baseUrl, contextWindow: 32_768, maxTokens: 1024, cost: prices }] } } }));
  const runtime = await createModelRuntime({ providerIds: ["kiro"], modelsPath: path, credentials, modelsStore, refreshOnCreate: false });
  const settings = SettingsManager.inMemory({ cacheWarming: "off", retry: { enabled: false }, compaction: { enabled: false } });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: pi, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "", appendSystemPrompt: [] }); await loader.reload();
  const { session } = await createAgentSession({ cwd: root, agentDir: pi, modelRuntime: runtime, model: runtime.getModel("kiro", "usage-fixture")!, thinkingLevel: "off", settingsManager: settings, resourceLoader: loader, sessionManager: SessionManager.inMemory(root), noTools: "all" });
  t.after(() => session.dispose());
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/");
    return kiroResponse([text(), ...(reported !== undefined ? [metadata(reported)] : [])]);
  });
  await session.prompt("Owned nonempty fixture context"); return session;
}

test("real AgentSession publishes Kiro window independently of zero/unknown measurement", async t => {
  for (const reported of [undefined, {}, zero]) await t.test(reported === undefined ? "missing" : Object.keys(reported).length ? "zero" : "partial", async sub => {
    const session = await sdk(sub, reported), view = agentSessionUsage(session)!;
    assert.equal(view.total, 0); assert.equal(view.context?.window, 32_768);
    assert.equal(view.lastMeasurement?.state, reported === undefined ? "unknown" : Object.keys(reported).length ? "complete" : "partial");
    if (reported === zero) {
      assert.deepEqual(view.lastRequest, { input: 0, cacheRead: 0, cacheWrite: 0 });
      assert.equal(view.context?.estimated, true, "SDK skips measured zero and uses a content estimate");
    }
    else { assert.equal(view.lastRequest, null); assert.equal(view.context?.estimated, true); assert.ok(view.context!.tokens! > 0); }
    const control = { model: { ...session.model!, provider: "control" }, sessionManager: session.sessionManager,
      getSessionStats: () => session.getSessionStats(), getContextUsage: () => session.getContextUsage() };
    assert.equal(agentSessionUsage(control), null, "unmarked zero-token nonKiro display behaviour stays unchanged");
  });
});

test("real AgentSession complete zero after older usage is an explicit context estimate, also after compaction", async t => {
  const session = await sdk(t, zero);
  const earlier = await native([text(), metadata({ ...full, uncachedInputTokens: 9999, totalTokens: 10005 })], prices);
  const latest = await native([text(), metadata(zero)], prices);
  for (const compacted of [false, true]) {
    session.sessionManager.appendMessage(earlier);
    if (compacted) session.sessionManager.appendCompaction("Owned compact summary", null, 10005);
    session.sessionManager.appendMessage(latest);
    const view = agentSessionUsage(session)!;
    assert.deepEqual(view.lastRequest, { input: 0, cacheRead: 0, cacheWrite: 0 });
    assert.equal(view.context?.estimated, true); assert.equal(view.context?.window, 32_768);
    assert.ok(view.context!.tokens! < 9999, "old nonzero usage must not become the latest exact context");
  }
});

test("Costs reopens native unmerged attempts as compression without changing ordinary usage categories", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-attempt-costs-")), cwd = join(root, "project"); mkdirSync(cwd);
  let store: Store | undefined;
  try {
    store = new Store(root); new TaskRecords(store);
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, manager = SessionManager.create(cwd, join(root, "sessions"));
    const actual = await native([text(), metadata(full)], prices), exactZero = await native([text(), metadata(zero)], prices);
    manager.appendMessage({ role: "user", content: "owned", timestamp: 1 }); manager.appendMessage(actual);
    manager.appendUsage(kiroCompactionAttemptKind, "kiro", "usage-fixture", kiroRequestUsage(model(prices)).usage);
    manager.appendUsage(kiroCompactionAttemptKind, "kiro", "usage-fixture", exactZero.usage);
    const { axiomKiro: _marker, ...controlUsage } = structuredClone(actual.usage) as typeof actual.usage & { axiomKiro?: unknown };
    manager.appendUsage("owned-other", "control", "control-model", controlUsage);
    const file = manager.getSessionFile()!, bytes = readFileSync(file, "utf8");
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file) VALUES(?,?)").run(session.id, file);
    store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,body TEXT NOT NULL)");
    store.close(); store = new Store(root);
    const report = new Costs(store).get(scope), attempts = report.rows.filter(row => row.category === "compression");
    assert.equal(attempts.length, 1); assert.equal(attempts[0].source, "原生压缩未合并请求");
    assert.equal(attempts[0].provider, "kiro"); assert.equal(attempts[0].records, 2);
    assert.equal(attempts[0].unknownCost, 1); assert.equal(attempts[0].unknownTokens, 1); assert.equal(attempts[0].knownCost, 0);
    assert.equal(report.rows.filter(row => row.category === "main").length, 1);
    assert.equal(report.rows.find(row => row.category === "other")?.source, "owned-other");
    assert.equal(report.total.records, 4); assert.equal(readFileSync(file, "utf8"), bytes);
  } finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
});

test("native transcript, processing, agent snapshot and compression JSON preserve provenance across DB reopen", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-usage-store-")), cwd = join(root, "project"); mkdirSync(cwd);
  let store: Store | undefined;
  try {
    store = new Store(root); new TaskRecords(store);
    const workspace = store.execute({ op: "workspace.open", requestId: crypto.randomUUID(), params: { path: cwd, authorized: true } }) as Workspace;
    const session = store.execute({ op: "session.create", workspaceId: workspace.id, requestId: crypto.randomUUID() }) as Session;
    const scope = { workspaceId: workspace.id, sessionId: session.id }, message = await native([text(), metadata(full), metadata({})], prices);
    const manager = SessionManager.create(cwd, join(root, "sessions")); manager.appendMessage({ role: "user", content: "owned", timestamp: 1 }); manager.appendMessage(message);
    const file = manager.getSessionFile()!, before = readFileSync(file, "utf8"), measurement = kiroUsageInfo(message.usage);
    const snapshot = { input: 10, output: 3, cacheRead: 2, cacheWrite: 1, total: 16, cost: null, context: null, lastRequest: null, lastMeasurement: measurement };
    store.db.prepare("INSERT INTO agent_sessions(sessionId,file,usage) VALUES(?,?,?)").run(session.id, file, JSON.stringify(snapshot));
    const records = ProcessingRecords.for(store), id = records.start(scope, "compression", "owned Kiro test"), call = records.callStart(id, "summary", { prompt: "owned" });
    records.callFinish(id, call, message, undefined, message.usage); records.finish(id, "completed");
    const exactZero = await native([text(), metadata(zero)], prices), summary = kiroSummaryUsage(exactZero.usage, [exactZero]);
    const job: Compression = { id: "zero-fixture", requestId: "zero-fixture", state: "cancelled", phase: "applying", startedAt: 1, endedAt: 2, appliedAt: null, messageCount: 1, before: 100, after: 0, summary: "owned summary", error: null, selection: { provider: "kiro", id: "usage-fixture" }, usage: kiroCompressionProjection(summary) };
    store.db.exec("CREATE TABLE compressions(id TEXT PRIMARY KEY,sessionId TEXT NOT NULL,body TEXT NOT NULL)");
    store.db.prepare("INSERT INTO compressions VALUES(?,?,?)").run(job.id, session.id, JSON.stringify(job));
    store.close(); store = new Store(root);
    const record = ProcessingRecords.for(store).command({ op: "processing.get", requestId: crypto.randomUUID(), workspaceId: workspace.id, params: { id } }) as ProcessingRecord;
    assert.deepEqual(kiroUsageInfo(record.calls[0]!.usage), measurement);
    assert.deepEqual(kiroUsageInfo(JSON.parse(record.calls[0]!.output!.text).usage), measurement);
    const reopened = SessionManager.open(file); assert.equal(lastRequestUsage(reopened), null);
    assert.equal(readFileSync(file, "utf8"), before); assert.deepEqual(kiroUsageInfo((reopened.getLeafEntry() as any).message.usage), measurement);
    assert.deepEqual(JSON.parse(String(store.db.prepare("SELECT usage FROM agent_sessions WHERE sessionId=?").get(session.id)!.usage)), snapshot);
    const report = new Costs(store).get(scope), main = report.rows.find(row => row.category === "main")!, compression = report.rows.find(row => row.category === "compression")!;
    assert.equal(main.unknownTokens, 1); assert.equal(main.unknownCost, 1); assert.equal(main.tokens.input, 10);
    assert.equal(compression.unknownTokens, 0); assert.equal(compression.unknownCost, 0); assert.equal(compression.knownCost, 0); assert.equal(compression.unknownParts, 0);
  } finally { store?.close(); rmSync(root, { recursive: true, force: true }); }
});
