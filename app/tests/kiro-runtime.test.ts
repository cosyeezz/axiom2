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

test("Kiro auth-only login survives worker/reopen without changing other OAuth providers", { timeout: 60000 }, async () => {
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
    assert.equal(view.templates.find(p => p.id === "kiro")?.api, "kiro-auth-only");
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
    const reopened = new ModelService(root), settings = await reopened.read();
    const entry = settings.providers.find(p => p.providerId === "kiro")!;
    assert.equal(entry.name, "kiro");
    assert.equal(entry.auth?.configured, true); assert.equal(entry.connectionType, "oauth");
    assert.equal(entry.api, "kiro-auth-only"); assert.deepEqual(entry.models, []);
    assert.equal(settings.templates.find(p => p.id === "kiro")?.api, "kiro-auth-only");
    assert.ok(!JSON.stringify(settings).includes("FIXTURE-CLIENT-SECRET"));
    const catalog = await reopened.catalog("kiro", settings.revision);
    assert.equal(catalog.source, "native"); assert.deepEqual(catalog.models, []); assert.match(catalog.message, /仅接入账号认证/);
    const instance = kiroProvider();
    assert.throws(() => instance.streamSimple({} as any, { messages: [] } as unknown as Parameters<typeof instance.streamSimple>[1]), /尚未实现模型推理/);
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
