import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ModelService } from "../src/server/model-service.js";
import { Logins } from "../src/server/auth.js";
import { closeModelNetworks } from "../src/server/model-network.js";
import { ensureModelProvider } from "../src/server/model-runtime.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

test("Kiro live discovery rejects failed or skipped refresh instead of reporting cached success", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-refresh-evidence-"));
  const previousDir = process.env.AXIOM_PI_DIR, previousFetch = globalThis.fetch;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  let calls = 0, status = 200;
  globalThis.fetch = async () => {
    calls++;
    const model = { modelId: "live-model", modelName: "Live model" };
    return new Response(JSON.stringify(status === 200 ? { models: [model], defaultModel: model } : { secret: "PRIVATE" }), { status });
  };
  try {
    const service = new ModelService(root, null); await service.raw();
    writeFileSync(join(service.dir, "models.json"), JSON.stringify({ providers: { kiro: { headers: {} } } }));
    writeFileSync(join(service.dir, "auth.json"), JSON.stringify({ kiro: { type: "oauth", access: "ACCESS", refresh: "REFRESH", expires: Date.now() + 3600000, authMethod: "builder-id", authRegion: "us-east-1" } }));
    const view = await service.read();
    const live = await service.catalog("kiro", view.revision);
    assert.deepEqual(live.models.map(model => model.id), ["live-model"]);
    assert.equal(live.models[0]?.contextWindow, undefined, "unknown limits are not displayed as zero");
    assert.equal(live.models[0]?.input, undefined, "missing upstream input declarations are displayed as unknown, not text-only");
    status = 403;
    await assert.rejects(service.catalog("kiro", view.revision), /无权读取模型目录/);
    assert.equal(calls, 2);
    const createRuntime = service.runtime.bind(service);
    service.runtime = async path => {
      const runtime = await createRuntime(path), checkAuth = runtime.checkAuth.bind(runtime);
      runtime.checkAuth = async (...args) => {
        const auth = await checkAuth(...args);
        if (auth) writeFileSync(join(service.dir, "auth.json"), "{}");
        return auth;
      };
      return runtime;
    };
    await assert.rejects(service.catalog("kiro", view.revision), /未完成本次实时拉取|认证在刷新期间已改变/);
    assert.equal(calls, 2, "a skipped network phase cannot be reported as live success");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Kiro login and live catalog survive worker/reopen without changing other OAuth providers", { timeout: 60000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-runtime-"));
  const env = { AXIOM_PI_DIR: process.env.AXIOM_PI_DIR, NODE_OPTIONS: process.env.NODE_OPTIONS, AXIOM_KIRO_FIXTURE_DIR: process.env.AXIOM_KIRO_FIXTURE_DIR };
  const originalFetch = globalThis.fetch;
  process.env.AXIOM_PI_DIR = join(root, "pi"); process.env.AXIOM_KIRO_FIXTURE_DIR = root;
  process.env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --require=${JSON.stringify(fileURLToPath(new URL("./fixtures/kiro-network.cjs", import.meta.url)))}`;
  globalThis.fetch = async () => { throw Error("Unexpected parent network in Kiro fixture"); };
  const service = new ModelService(root), owner = {};
  const logins = new Logins(service, () => {}, async () => {});
  try {
    const view = await service.read();
    assert.equal(view.templates.find(p => p.id === "kiro")?.name, "kiro");
    assert.equal(view.templates.find(p => p.id === "kiro")?.api, "kiro-chat");
    assert.deepEqual(view.templates.find(p => p.id === "kiro")?.methods, ["oauth"]);
    assert.ok(view.templates.some(p => p.id === "codebuddy-cn"));
    const runtime = await service.runtime();
    assert.equal(runtime.getRegisteredNativeProvider("kiro"), undefined);
    const before = runtime.getProviders().map(p => ({ id: p.id, oauth: p.auth.oauth, provider: p }));
    await ensureModelProvider(runtime, "kiro");
    for (const item of before) { assert.equal(runtime.getProvider(item.id), item.provider); assert.equal(runtime.getProvider(item.id)?.auth.oauth, item.oauth); }
    const first = runtime.getRegisteredNativeProvider("kiro"); await ensureModelProvider(runtime, "kiro");
    assert.equal(runtime.getRegisteredNativeProvider("kiro"), first);
    assert.deepEqual(runtime.getModels("kiro"), []);
    const flow = await logins.start(owner, "kiro", "oauth", view.revision);
    await assert.rejects(logins.start(owner, "codebuddy-cn", "oauth", view.revision), /已有认证流程/);
    const deadline = Date.now() + 15000, answered = new Set<string>();
    while (service.authActive) {
      const state = logins.get(owner, flow.id).state;
      assert.notEqual(state.status, "failed", state.message);
      assert.ok(Date.now() < deadline, state.message);
      if (state.prompt && !answered.has(state.prompt.id)) {
        answered.add(state.prompt.id);
        const answer = state.prompt.options?.some(option => option.id === "builder-id") ? "builder-id" : "device";
        logins.answer(owner, flow.id, state.prompt.id, answer);
      }
      await delay(10);
    }
    assert.equal(logins.get(owner, flow.id).state.status, "completed");
    const stored = JSON.parse(readFileSync(join(service.dir, "auth.json"), "utf8"));
    assert.equal(stored.kiro.authMethod, "builder-id"); assert.equal(stored.kiro.clientSecret, "FIXTURE-CLIENT-SECRET");
    const requests = readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.ok(requests.every(r => r.worker === "1")); assert.equal(requests.length, 3);
    const draft = await service.read();
    await service.save({ revision: draft.revision, providers: draft.providers });
    const persistedConfig = JSON.parse(await service.raw()).providers.kiro;
    assert.equal(persistedConfig.api, undefined, "auth-only metadata is never persisted as a fake inference protocol");
    assert.equal(persistedConfig.baseUrl, undefined);
    assert.equal((persistedConfig.models ?? []).length, 0);
    // Unrelated entries survive Kiro's later logout, not just initial registration.
    stored["unrelated-fixture"] = { type: "api_key", key: "OTHER-SECRET" };
    writeFileSync(join(service.dir, "auth.json"), JSON.stringify(stored));
    const unrelatedConfig = JSON.parse(await service.raw());
    unrelatedConfig.providers["unrelated-fixture"] = { api: "openai-completions", baseUrl: "https://unrelated.invalid/v1", models: [] };
    writeFileSync(join(service.dir, "models.json"), JSON.stringify(unrelatedConfig));
    const reopened = new ModelService(root), settings = await reopened.read();
    const entry = settings.providers.find(p => p.providerId === "kiro")!;
    assert.equal(entry.name, "kiro");
    assert.equal(entry.auth?.configured, true); assert.equal(entry.connectionType, "oauth");
    assert.equal(entry.api, "kiro-chat"); assert.deepEqual(entry.models, []);
    assert.equal(settings.templates.find(p => p.id === "kiro")?.api, "kiro-chat");
    assert.ok(!JSON.stringify(settings).includes("FIXTURE-CLIENT-SECRET"));
    const catalog = await reopened.catalog("kiro", settings.revision);
    assert.equal(catalog.source, "native"); assert.deepEqual(catalog.models.map(model => model.id), ["fixture-kiro-model"]);
    assert.equal(catalog.models[0]?.contextWindow, 123456); assert.deepEqual(catalog.models[0]?.input, ["text", "image"]); assert.match(catalog.message, /实时拉取/); assert.match(catalog.message, /文本聊天.*工具调用/);
    const restored = await reopened.runtime();
    assert.deepEqual(restored.getModels("kiro").map(model => model.id), ["fixture-kiro-model"]);
    const allRequests = readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(allRequests.length, 4); assert.ok(allRequests.every(request => request.worker === "1"));
    const cache = readFileSync(join(service.dir, "models-store.json"), "utf8");
    assert.ok(!cache.includes("FIXTURE-REFRESH")); assert.ok(!cache.includes("FIXTURE-ACCESS")); assert.ok(!cache.includes("FIXTURE-CLIENT-SECRET"));
    await assert.rejects(reopened.catalog("kiro", settings.revision + "-stale"), /配置已改变|重新读取|过期/);
    const imported = catalog.models[0]!;
    const importDraft = await reopened.read();
    importDraft.providers.find(p => p.providerId === "kiro")!.models.push({ key: imported.id, id: imported.id, name: imported.name, levels: ["none"], input: [...imported.input!], headers: [], body: [] });
    await reopened.save(importDraft);
    const importedRuntime = await new ModelService(root).runtime();
    assert.equal(importedRuntime.getModel("kiro", imported.id)?.api, "kiro-chat");
    assert.deepEqual(importedRuntime.getModel("kiro", imported.id)?.input, ["text", "image"]);
    const snapshotPath = join(root, "snapshot.json");
    writeFileSync(snapshotPath, JSON.stringify({ providers: { kiro: { modelOverrides: { [imported.id]: { name: "Snapshot catalog model" } } } } }));
    const snapshot = await reopened.runtime(snapshotPath), snapshotModel = snapshot.getModel("kiro", imported.id)!;
    assert.equal(snapshotModel.name, "Snapshot catalog model");
    assert.equal(readFileSync(join(service.dir, "models-store.json"), "utf8"), cache, "offline reads and saves never rewrite the catalog cache");
    const maliciousPath = join(root, "custom-inference.json");
    writeFileSync(maliciousPath, JSON.stringify({ providers: { kiro: { api: "openai-completions", baseUrl: "https://untrusted.invalid/v1", models: [{ id: "custom-bypass", contextWindow: 1000, maxTokens: 100 }] } } }));
    const malicious = await reopened.runtime(maliciousPath), maliciousModel = malicious.getModel("kiro", "custom-bypass")!;
    assert.ok(maliciousModel);
    let inferenceRequests = 0;
    for (const complete of [snapshot.complete.bind(snapshot), snapshot.completeSimple.bind(snapshot)]) {
      const result = await complete(snapshotModel, { messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", mimeType: "image/png", data: "AA==" }], timestamp: 1 }] }, { fetch: async (_url, init) => {
        inferenceRequests++;
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer FIXTURE-ACCESS");
        assert.equal(JSON.parse(String(init?.body)).conversationState.currentMessage.userInputMessage.modelId, imported.id);
        assert.deepEqual(JSON.parse(String(init?.body)).conversationState.currentMessage.userInputMessage.images, [{ format: "png", source: { bytes: "AA==" } }]);
        return kiroResponse([kiroFrame("assistantResponseEvent", { content: "Native answer" })]);
      } });
      assert.equal(result.stopReason, "stop", result.errorMessage); assert.deepEqual(result.content, [{ type: "text", text: "Native answer" }]);
    }
    assert.equal(inferenceRequests, 2, "saved and reopened catalog models reach the native adapter through both SDK entrypoints");
    for (const complete of [malicious.complete.bind(malicious), malicious.completeSimple.bind(malicious)]) {
      const result = await complete(maliciousModel, { messages: [{ role: "user", content: "hello", timestamp: 1 }] }, { fetch: async () => { inferenceRequests++; throw Error("MUST NOT INFER"); } });
      assert.equal(result.stopReason, "error"); assert.ok(!result.errorMessage?.includes("FIXTURE-ACCESS"));
    }
    assert.equal(inferenceRequests, 2, "custom API overrides cannot obtain Kiro OAuth tokens");
    const safeConfig = await reopened.raw(), customConfig = JSON.parse(safeConfig);
    customConfig.providers.kiro.baseUrl = "https://untrusted.invalid/v1"; customConfig.providers.kiro.api = "openai-completions";
    writeFileSync(join(service.dir, "models.json"), JSON.stringify(customConfig));
    const customView = await reopened.read();
    await assert.rejects(reopened.catalog("kiro", customView.revision), /固定 AWS|Base URL/);
    assert.equal(readFileSync(join(root, "requests.jsonl"), "utf8").trim().split("\n").length, 4, "import, reopen, inference rejection and URL validation cannot issue network requests");
    writeFileSync(join(service.dir, "models.json"), safeConfig);
    const instance = kiroProvider();
    const denied = await instance.streamSimple({} as any, { messages: [] } as unknown as Parameters<typeof instance.streamSimple>[1]).result();
    assert.equal(denied.stopReason, "error"); assert.match(denied.errorMessage!, /kiro-chat/);
    await (await reopened.runtime()).logout("kiro");
    const remaining = JSON.parse(readFileSync(join(service.dir, "auth.json"), "utf8"));
    assert.equal(remaining.kiro, undefined); assert.equal(remaining["unrelated-fixture"].key, "OTHER-SECRET");
  } finally {
    await logins.close(); await closeModelNetworks(root);
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
});
