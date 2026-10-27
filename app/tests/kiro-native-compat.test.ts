import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, type Context, type ModelsStoreEntry } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { kiroCatalogScope } from "../src/server/providers/kiro-catalog.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const context: Context = { messages: [{ role: "user", content: "isolated fixture", timestamp: 1 }] };
async function fixture(scope: "current" | "other" = "current") {
  const root = mkdtempSync(join(tmpdir(), "axiom-kiro-native-compat-"));
  const account: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" };
  const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
  await credentials.modify("kiro", async () => account);
  await modelsStore.write("kiro", { cacheVersion: 2, cacheScope: scope === "current" ? kiroCatalogScope(account) : "other-account", checkedAt: Date.now(), models: [] } as ModelsStoreEntry);
  const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { kiro: { api: "kiro-chat", models: [{ id: "explicit-model", name: "Explicit", baseUrl: "https://q.us-east-1.amazonaws.com", contextWindow: 8192, maxTokens: 1024 }] } } }));
  try {
    const runtime = await createModelRuntime({ providerIds: ["kiro"], credentials, modelsStore, modelsPath, refreshOnCreate: false });
    assert.equal(runtime.getError(), undefined);
    return { root, runtime, account, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}

test("Kiro without model overrides survives native catalog access, credential login and logout without recursion", async t => {
  for (const providers of [{}, { kiro: { headers: {} } }]) {
    const root = mkdtempSync(join(tmpdir(), "axiom-kiro-native-uncomposed-"));
    try {
      const credentials = new InMemoryCredentialStore(), modelsStore = new InMemoryModelsStore();
      const modelsPath = join(root, "models.json");
      writeFileSync(modelsPath, JSON.stringify({ providers }));
      const runtime = await createModelRuntime({ providerIds: ["kiro"], credentials, modelsStore, modelsPath, refreshOnCreate: false });
      assert.equal(runtime.getError(), undefined);
      const native = runtime.getRegisteredNativeProvider("kiro")!;
      const account: KiroCredential = { type: "oauth", access: "FIXTURE-ACCESS", refresh: "FIXTURE-REFRESH", expires: Date.now() + 3_600_000, authMethod: "builder-id", authRegion: "us-east-1" };
      // Only the credential-producing login interaction is stubbed. SDK storage,
      // recomposition, scope refresh and availability synchronization are real.
      t.mock.method(runtime.getProvider("kiro")!.auth.oauth!, "login", async () => account);
      assert.deepEqual(native.getModels(), []);
      assert.deepEqual(native.getAllModels?.(), []);
      await runtime.login("kiro", "oauth", { signal: new AbortController().signal, notify() {}, prompt: async () => { throw Error("Unexpected login prompt"); } });
      assert.equal((await credentials.read("kiro"))?.type, "oauth");
      assert.deepEqual(runtime.getModels("kiro"), []);
      assert.deepEqual(await runtime.getAvailable("kiro"), []);
      await runtime.logout("kiro");
      assert.equal(await credentials.read("kiro"), undefined);
      assert.deepEqual(native.getModels(), []);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

for (const scope of ["current", "other"] as const) test(`Kiro empty ${scope}-scope catalog routes legitimate explicit models natively without a global API or fake models`, async () => {
  const f = await fixture(scope);
  try {
    const native = f.runtime.getRegisteredNativeProvider("kiro")!;
    assert.deepEqual(native.getAllModels?.(), [], "real catalog stays empty; no capability marker");
    assert.deepEqual(f.runtime.getModels("kiro").map(model => model.id), ["explicit-model"]);
    assert.deepEqual((await f.runtime.getAvailable("kiro")).map(model => model.id), ["explicit-model"], "offline refresh scopes explicit configuration to the current credential, never another account's catalog");
    assert.equal(getApiProvider("kiro-chat"), undefined);
    let calls = 0;
    const fetch: typeof globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(String(url), "https://runtime.us-east-1.kiro.dev/");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer FIXTURE-ACCESS");
      assert.equal(JSON.parse(String(init?.body)).conversationState.currentMessage.userInputMessage.modelId, "explicit-model");
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "fixture answer" })]);
    };
    const model = f.runtime.getModel("kiro", "explicit-model")!;
    for (const complete of [f.runtime.complete.bind(f.runtime), f.runtime.completeSimple.bind(f.runtime)]) {
      const result = await complete(model, context, { fetch });
      assert.equal(result.stopReason, "stop", result.errorMessage);
    }
    assert.equal(calls, 2);
    assert.equal(getApiProvider("kiro-chat"), undefined);
    assert.deepEqual(native.getAllModels?.(), []);
  } finally { f.cleanup(); }
});

test("Kiro SDK stream APIs re-resolve each physical request instead of reusing a prefetched one-use handoff", async t => {
  const f = await fixture();
  try {
    const model = f.runtime.getModel("kiro", "explicit-model")!, native = f.runtime.getRegisteredNativeProvider("kiro")!;
    const auth = await f.runtime.getAuth(model);
    assert.match(auth!.auth.apiKey!, /^axiom-kiro-native:/);
    const tickets: string[] = [];
    for (const name of ["stream", "streamSimple"] as const) {
      const original = native[name].bind(native);
      t.mock.method(native, name, (...[target, transcript, options]: Parameters<typeof native.stream> & Parameters<typeof native.streamSimple>) => {
        tickets.push(options!.apiKey!);
        return original(target, transcript, options);
      });
    }
    let calls = 0;
    const options = { apiKey: auth!.auth.apiKey, fetch: async () => {
      calls++;
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "physical request" })]);
    } };
    for (const stream of [f.runtime.stream.bind(f.runtime), f.runtime.streamSimple.bind(f.runtime)]) {
      for (let i = 0; i < 2; i++) {
        const output = stream(model, context, options);
        assert.equal(typeof output.result, "function", "SDK stream contract stays synchronous");
        const result = await output.result();
        assert.equal(result.stopReason, "stop", result.errorMessage);
      }
    }
    assert.equal(calls, 4);
    assert.equal(tickets.length, 4);
    assert.equal(new Set(tickets).size, 4);
    assert.ok(tickets.every(ticket => ticket !== auth!.auth.apiKey));
    assert.equal(options.apiKey, auth!.auth.apiKey, "caller options are not mutated");
    const denied = await f.runtime.completeSimple(model, context, { ...options, apiKey: "GENERIC-KEY" });
    assert.equal(denied.stopReason, "error");
    assert.equal(calls, 4, "generic API keys never reach fetch");
    const cancelled = new AbortController(); cancelled.abort();
    const aborted = await f.runtime.completeSimple(model, context, { ...options, signal: cancelled.signal });
    // Pi's lazy stream reports cancellation in pre-auth as error, before native
    // stream starts. Host cancellation still must prevent any physical request.
    assert.equal(aborted.stopReason, "error");
    assert.equal(calls, 4);
  } finally { f.cleanup(); }
});
