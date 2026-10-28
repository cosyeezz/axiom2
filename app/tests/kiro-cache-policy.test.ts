import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as turn } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { InMemoryCredentialStore, InMemoryModelsStore, type AssistantMessage, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { disableKiroCacheWarming } from "../src/server/kiro-cache-policy.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

type Mode = "off" | "idle" | undefined;
type Profile = "main" | "task" | "compression";
const settingsBase = { packages: [], compaction: { enabled: false }, retry: { enabled: false } };
const cost = { input: 10, output: 2, cacheRead: 0.1, cacheWrite: 10 };
const usage = { input: 100_000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 100_001,
  cost: { input: 1, output: 0.000002, cacheRead: 0, cacheWrite: 0, total: 1.000002 } };

// Exercise the SDK's real business-stream -> CacheWarmer -> runtime -> HTTP path.
// Profiles mirror the worker's public settings construction, not private state.
async function fixture(t: TestContext, options: { mode?: Mode; profile?: Profile; guard?: boolean; provider?: "kiro" | "control"; forceWarm?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-warm-")), agentDir = join(root, "pi");
  mkdirSync(agentDir);
  let session: AgentSession | undefined;
  const pendingResponses: (() => void)[] = [];
  t.after(async () => {
    for (const release of pendingResponses) release();
    await session?.abort(); session?.dispose();
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(agentDir, "settings.json"), global = { ...settingsBase, ...(options.mode ? { cacheWarming: options.mode } : {}) };
  writeFileSync(path, JSON.stringify(global));
  const project = SettingsManager.create(root, agentDir, { projectTrusted: true });
  const settings = options.profile === "task"
    ? SettingsManager.fromStorage({ withLock: (scope, fn) => { fn(JSON.stringify({ ...global, ...(scope === "global" ? { cacheWarming: "off" } : {}) })); } }, { projectTrusted: true })
    : options.profile === "compression" ? SettingsManager.inMemory({ ...settingsBase, cacheWarming: "off" }) : project;
  // This is the old host override. A no-guard main baseline MUST still warm.
  settings.applyOverrides({ cacheWarming: "off" });
  const credential: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH",
    expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" };
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => credential);
  await credentials.modify("control", async () => ({ type: "api_key", key: "FIXTURE-CONTROL" }));
  await modelsStore.write("kiro", { checkedAt: 1, cacheVersion: 2, cacheScope: kiroCatalogScope(credential), models: [] } as ModelsStoreEntry);
  const modelDefinition = { id: "cache-fixture", contextWindow: 2_000_000, maxTokens: 1024, cost, promptCache: { short: 60, long: 60 } };
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: {
    kiro: { api: "kiro-chat", models: [{ ...modelDefinition, baseUrl: "https://q.us-east-1.amazonaws.com" }] },
    control: { api: "openai-completions", baseUrl: "https://control.invalid/v1", models: [modelDefinition] },
  } }));
  const runtime = await createModelRuntime({ providerIds: ["kiro"], modelsPath, credentials, modelsStore, refreshOnCreate: false });
  assert.equal(runtime.getError(), undefined);
  const kiro = runtime.getModel("kiro", "cache-fixture")!, control = runtime.getModel("control", "cache-fixture")!;
  assert.ok(kiro); assert.ok(control); assert.equal(kiro.promptCache?.short, 60); assert.deepEqual(kiro.cost, cost);
  const model = options.provider === "control" ? control : kiro;
  if (options.guard !== false) disableKiroCacheWarming(settings, () => session?.model ?? model);
  const manager = SessionManager.inMemory(root);
  const prior: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "PRIOR" }], api: model.api,
    provider: model.provider, model: model.id, timestamp: 1, stopReason: "stop", usage: structuredClone(usage) };
  manager.appendMessage({ role: "user", content: "PRIOR", timestamp: 1 }); manager.appendMessage(prior);
  let decisions = 0;
  const loader = new DefaultResourceLoader({ cwd: root, agentDir, settingsManager: settings,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPrompt: "", appendSystemPrompt: [], extensionFactories: options.forceWarm ? [pi => {
      pi.on("cache_warming_decision", () => { decisions++; return { action: "warm" }; });
    }] : [] });
  await loader.reload();
  ({ session } = await createAgentSession({ cwd: root, agentDir, modelRuntime: runtime, model, thinkingLevel: "off",
    settingsManager: settings, resourceLoader: loader, sessionManager: manager, noTools: "all" }));
  await session.bindExtensions({ mode: "rpc", onError: () => {} });
  const live = session;
  const requests: string[] = [];
  const reply = (provider: string) => provider === "kiro" ? kiroResponse([
    kiroFrame("assistantResponseEvent", { content: "FIXTURE_REPLY" }),
    kiroFrame("metadataEvent", { tokenUsage: { uncachedInputTokens: 100_000, outputTokens: 1, cacheReadInputTokens: 0, cacheWriteInputTokens: 0, totalTokens: 100_001 } }),
  ]) : new Response([
    { choices: [{ index: 0, delta: { role: "assistant", content: "FIXTURE_REPLY" }, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 100_000, completion_tokens: 1, total_tokens: 100_001 } },
  ].map(chunk => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "cache-fixture", ...chunk })}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  let hold: { entered(): void; release?: () => void } | undefined;
  t.mock.method(globalThis, "fetch", async (url: Parameters<typeof fetch>[0]) => {
    const provider = String(url) === "https://runtime.us-east-1.kiro.dev/" ? "kiro" : "control";
    assert.equal(String(url), provider === "kiro" ? "https://runtime.us-east-1.kiro.dev/" : "https://control.invalid/v1/chat/completions");
    requests.push(provider);
    if (!hold) return reply(provider);
    const block = hold; hold = undefined;
    return new Promise<Response>(resolve => {
      block.release = () => resolve(reply(provider)); pendingResponses.push(block.release); block.entered();
    });
  });
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  const advance = async () => { t.mock.timers.tick(50_000); await turn(); await turn(); };
  const warms = () => manager.getBranch().filter(entry => entry.type === "usage" && entry.kind === "cache_warm");
  const waitForWarm = async (count: number) => {
    // The SDK timer starts an asynchronous refresh; mocked time must stay at the
    // trigger while auth, lazy API imports, HTTP and usage persistence settle.
    const deadline = performance.now() + 30_000;
    while (warms().length < count) {
      assert.ok(performance.now() < deadline, JSON.stringify({ status: live.cacheWarmingStatus, decisions, requests,
        assistant: live.messages.filter(message => message.role === "assistant").at(-1) }));
      await turn();
    }
  };
  const holdNext = () => {
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const block = { entered, release: undefined as (() => void) | undefined }; hold = block;
    return { started, release: () => block.release!() };
  };
  const blocked = async () => {
    const block = holdNext(), run = live.prompt("BUSINESS_REQUEST");
    await Promise.race([block.started, run.then(() => { throw Error("business prompt ended before reaching isolated HTTP"); })]);
    return { run, release: block.release };
  };
  return { session: live, runtime, manager, settings, path, kiro, control, requests, advance, blocked, holdNext,
    decisions: () => decisions, warms, waitForWarm };
}

test("positive SDK baselines really warm with valid TTL, price and usage despite applyOverrides(off)", async t => {
  for (const mode of [undefined, "idle", "off"] as const) await t.test(mode ?? "default streaming", async st => {
    const f = await fixture(st, { mode, guard: false, forceWarm: true });
    const business = await f.blocked();
    if (mode === "idle") { business.release(); await business.run; }
    if (mode !== "off") {
      assert.equal(f.session.cacheWarmingStatus?.state, "scheduled");
      assert.equal(f.session.cacheWarmingStatus?.decision?.economicsAvailable, true);
    }
    await f.advance();
    if (mode !== "off") await f.waitForWarm(1);
    assert.deepEqual(f.requests, mode === "off" ? ["kiro"] : ["kiro", "kiro"]);
    assert.equal(f.warms().length, mode === "off" ? 0 : 1);
    assert.equal(f.decisions(), mode === "off" ? 0 : 1, "the forcing extension is actually bound in the positive baseline");
    business.release(); await business.run;
  });
});

test("instance gate blocks extra Kiro HTTP and usage across main/task/compression settings profiles", async t => {
  for (const profile of ["main", "task", "compression"] as const) for (const mode of [undefined, "idle", "off"] as const)
    await t.test(`${profile}/${mode ?? "default streaming"}`, async st => {
      const f = await fixture(st, { profile, mode, forceWarm: true });
      const before = readFileSync(f.path, "utf8"), business = await f.blocked();
      assert.equal(f.settings.getCacheWarmingMode(), "off");
      assert.equal(f.session.cacheWarmingStatus?.state, "inactive");
      await f.advance();
      business.release(); await business.run;
      await f.advance();
      assert.deepEqual(f.requests, ["kiro"]); assert.deepEqual(f.warms(), []); assert.equal(f.decisions(), 0);
      assert.equal(readFileSync(f.path, "utf8"), before, "policy did not write a persistent global off setting");
    });
});

test("gate follows effective setModel through both directions, same-model reuse and failed switching", async t => {
  const f = await fixture(t, { mode: "idle" });
  await f.session.prompt("KIRO_FIRST"); await f.advance();
  assert.deepEqual(f.requests, ["kiro"]);
  await f.session.setModel(f.kiro);
  assert.equal(f.settings.getCacheWarmingMode(), "off");
  const checkAuth = f.runtime.checkAuth.bind(f.runtime);
  const denied = t.mock.method(f.runtime, "checkAuth", async (...args: Parameters<typeof checkAuth>) => args[0] === "control" ? false : checkAuth(...args));
  await assert.rejects(f.session.setModel(f.control), /No API key for control/);
  assert.equal(f.session.model?.provider, "kiro"); assert.equal(f.settings.getCacheWarmingMode(), "off");
  denied.mock.restore();
  await f.session.setModel(f.control);
  assert.equal(f.settings.getCacheWarmingMode(), "idle");
  await f.session.prompt("CONTROL_BUSINESS"); await f.advance(); await f.waitForWarm(1);
  assert.deepEqual(f.requests, ["kiro", "control", "control"]);
  assert.equal(f.warms().length, 1);
  await f.session.setModel(f.kiro);
  assert.equal(f.settings.getCacheWarmingMode(), "off");
  await f.advance();
  assert.deepEqual(f.requests, ["kiro", "control", "control"], "old control timer cannot dispatch after switching to Kiro");
  await f.session.prompt("KIRO_REUSE"); await f.advance();
  assert.deepEqual(f.requests, ["kiro", "control", "control", "kiro"]);
  assert.equal(f.warms().length, 1);
});

test("non-Kiro SDK baseline is unchanged, and reload/save preserve global policy", async t => {
  const f = await fixture(t, { mode: "idle", provider: "control" });
  await f.session.prompt("CONTROL"); await f.advance(); await f.waitForWarm(1);
  assert.deepEqual(f.requests, ["control", "control"]); assert.equal(f.warms().length, 1);
  f.settings.setTheme("fixture-theme"); await f.settings.flush();
  assert.equal(JSON.parse(readFileSync(f.path, "utf8")).cacheWarming, "idle");
  await f.session.setModel(f.kiro);
  writeFileSync(f.path, JSON.stringify({ ...settingsBase, cacheWarming: "idle", theme: "external-theme" }));
  await f.settings.reload();
  assert.equal(f.settings.getGlobalSettings().cacheWarming, "idle"); assert.equal(f.settings.getCacheWarmingMode(), "off");
  await f.session.setModel(f.control);
  assert.equal(f.settings.getCacheWarmingMode(), "idle");
  await f.session.prompt("CONTROL_AFTER_RELOAD"); await f.advance(); await f.waitForWarm(2);
  assert.deepEqual(f.requests, ["control", "control", "control", "control"]);
  assert.equal(f.warms().length, 2);
});

test("non-Kiro default streaming and off keep their real SDK warming behavior", async t => {
  for (const mode of [undefined, "off"] as const) await t.test(mode ?? "default streaming", async st => {
    const f = await fixture(st, { mode, provider: "control", forceWarm: true });
    const business = await f.blocked(); await f.advance();
    if (mode !== "off") await f.waitForWarm(1);
    assert.deepEqual(f.requests, mode === "off" ? ["control"] : ["control", "control"]);
    assert.equal(f.warms().length, mode === "off" ? 0 : 1);
    business.release(); await business.run; await f.advance();
    assert.deepEqual(f.requests, mode === "off" ? ["control"] : ["control", "control"]);
  });
});

test("switching to Kiro cannot retract dispatched control HTTP but blocks further warming and stale usage", async t => {
  const f = await fixture(t, { mode: "idle", provider: "control" });
  await f.session.prompt("CONTROL");
  const warm = f.holdNext(); await f.advance(); await warm.started;
  assert.deepEqual(f.requests, ["control", "control"], "the control warm request was already physically dispatched");
  await f.session.setModel(f.kiro);
  assert.equal(f.settings.getCacheWarmingMode(), "off");
  warm.release(); await turn(); await turn(); await f.advance();
  assert.deepEqual(f.requests, ["control", "control"]); assert.deepEqual(f.warms(), []);
  await f.session.prompt("KIRO_AFTER_CONTROL_WARM"); await f.advance();
  assert.deepEqual(f.requests, ["control", "control", "kiro"]); assert.deepEqual(f.warms(), []);
});

test("Kiro cancel and dispose cannot leave a speculative warm request or usage entry", async t => {
  const f = await fixture(t, { mode: "idle", forceWarm: true });
  const business = await f.blocked();
  await f.session.abort(); await business.run;
  await f.advance();
  assert.deepEqual(f.requests, ["kiro"]); assert.deepEqual(f.warms(), []);
  f.session.dispose(); business.release(); await f.advance();
  assert.deepEqual(f.requests, ["kiro"]); assert.deepEqual(f.warms(), []); assert.equal(f.decisions(), 0);
});
