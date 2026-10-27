import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore, type Api, type Model, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { kiroProvider, kiroConnectionNotices } from "../src/server/providers/kiro.js";
import { assertKiroChatModel } from "../src/server/providers/kiro-chat-protocol.js";
import { ModelService } from "../src/server/model-service.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";

const account = (): KiroCredential => ({ type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" });
const page = { models: [{ modelId: "fixture-model", modelName: "Fixture" }], defaultModel: { modelId: "fixture-model" } };

test("Kiro cache diagnostics distinguish restore reasons without changing scope or offline storage", async () => {
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => account());
  let calls = 0, fail = false;
  const provider = kiroProvider({ fetch: async () => { calls++; return new Response(JSON.stringify(fail ? {} : page), { status: fail ? 403 : 200 }); } });
  const models = createModels({ credentials, modelsStore }); models.setProvider(provider);
  assert.equal(provider.catalogState().cacheReason, "uninitialized");
  await models.refresh({ allowNetwork: false });
  assert.equal(provider.catalogState().cacheReason, "missing"); assert.equal(calls, 0);
  await models.refresh({ force: true });
  const valid = (await modelsStore.read("kiro"))!;
  assert.equal(provider.catalogState().source, "network"); assert.equal(provider.catalogState().generation, 1);
  assert.equal(provider.catalogState().refresh, "succeeded");
  const scenarios: [ModelsStoreEntry, string, number][] = [
    [valid, "restored-v2", 1],
    [{ ...valid, cacheVersion: 1 }, "restored-v1", 1],
    [{ ...valid, cacheScope: "other-account" }, "scope-mismatch", 0],
    [{ models: valid.models }, "unscoped", 0],
    [{ ...valid, cacheVersion: 999 }, "unsupported-version", 0],
    [{ ...valid, models: [{ id: "bad" }] }, "invalid", 0],
  ] as [ModelsStoreEntry, string, number][];
  for (const [stored, reason, count] of scenarios) {
    await modelsStore.write("kiro", stored);
    await models.refresh({ allowNetwork: false });
    const state = provider.catalogState();
    assert.equal(state.cacheReason, reason); assert.equal(provider.getModels().length, count);
    assert.equal(state.generation, 1); assert.equal(calls, 1);
    assert.deepEqual(await modelsStore.read("kiro"), stored, "diagnostics cannot rewrite or migrate caches offline");
    const notices = JSON.stringify(kiroConnectionNotices({}, state));
    assert.ok(!/PRIVATE|other-account|cacheScope|cacheVersion/.test(notices));
    assert.match(notices, /主动点击.*受控联网刷新/); assert.match(notices, /不代表.*权限已验证/);
  }
  await modelsStore.write("kiro", valid); fail = true;
  assert.equal((await models.refresh({ force: true })).errors.size, 1);
  assert.equal(provider.catalogState().refresh, "failed"); assert.equal(provider.catalogState().source, "cache");
  assert.equal(provider.catalogState().generation, 1); assert.equal(provider.getModels().length, 1);
  assert.match(kiroConnectionNotices({}, provider.catalogState()).join("\n"), /刷新失败.*同|刷新失败.*缓存/);
  await credentials.delete("kiro");
  assert.equal(await credentials.read("kiro"), undefined, "modify(undefined) would keep the old credential; logout must really delete it");
  await models.refresh({ allowNetwork: false });
  assert.equal(provider.catalogState().cacheReason, "credential-unavailable"); assert.deepEqual(provider.getModels(), []);
  assert.equal(calls, 2);
});

test("Kiro protocol diagnostics explain explicit migration without exposing rejected model data", () => {
  const model = { provider: "kiro", api: "kiro-chat", id: "fixture", baseUrl: "" } as Model<Api>;
  for (const baseUrl of ["", "https://q.us-east-1.amazonaws.com", "https://q.eu-central-1.amazonaws.com/"]) assert.doesNotThrow(() => assertKiroChatModel({ ...model, baseUrl }));
  for (const patch of [{ api: "kiro-auth-only" }, { api: "openai-completions" }, { baseUrl: "https://PRIVATE-SECRET.invalid/v1" }]) {
    assert.throws(() => assertKiroChatModel({ ...model, ...patch }), error => error instanceof Error && /手动/.test(error.message) && /modelId.*账号.*代理/.test(error.message) && !error.message.includes("PRIVATE-SECRET"));
  }
});

test("Kiro configuration exposes read-only notices and catalog success does not claim inference/tool validation", async () => {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-diagnostics-"));
  const previousDir = process.env.AXIOM_PI_DIR, previousFetch = globalThis.fetch;
  process.env.AXIOM_PI_DIR = join(root, "pi");
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(page)); };
  try {
    const service = new ModelService(root, null); await service.raw();
    const config = JSON.stringify({ providers: { kiro: { headers: {} } } });
    writeFileSync(join(service.dir, "models.json"), config);
    writeFileSync(join(service.dir, "auth.json"), JSON.stringify({ kiro: account() }));
    const view = await service.read();
    assert.match(view.providers.find(p => p.providerId === "kiro")!.notices!.join("\n"), /目录缓存.*主动点击/);
    assert.equal(calls, 0); assert.equal(await service.raw(), config);
    const catalog = await service.catalog("kiro", view.revision);
    assert.match(catalog.message, /尚未验证文本聊天或工具调用权限/); assert.match(catalog.message, /零值单价不代表免费/);
    assert.ok(!catalog.message.includes("添加后可使用")); assert.equal(calls, 1);
    await service.read(); assert.equal(calls, 1); assert.equal(await service.raw(), config);
    const notices = kiroConnectionNotices({ api: "openai-completions", baseUrl: "https://PRIVATE-SECRET.invalid" });
    assert.ok(!JSON.stringify(notices).includes("PRIVATE-SECRET"));
    assert.match(notices.join("\n"), /手动改为 kiro-chat/); assert.match(notices.join("\n"), /不会.*自动|自动.*不会/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previousDir;
    rmSync(root, { recursive: true, force: true });
  }
});
