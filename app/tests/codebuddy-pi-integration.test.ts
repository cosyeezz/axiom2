import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore, type Context } from "@earendil-works/pi-ai";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { codeBuddyChat, CODEBUDDY_TICKET_PREFIX, CODEBUDDY_IDENTITY_METADATA } from "../src/server/providers/codebuddy-chat.js";
import { codeBuddyProvider } from "../src/server/providers/codebuddy-cn.js";
import { codeBuddyNativeFetch } from "../src/native-providers/codebuddy/http.js";
import { providerRequestDefaultTransport, providerRequestHttpTransport, observeProviderRequests } from "../src/server/provider-request-observer.js";
import { ProviderRequestTracker } from "../src/server/provider-request-statistics.js";
import { withCodeBuddyRunIdentity } from "../src/server/codebuddy-run-identity.js";

const id = "codebuddy-cn", modelId = "deepseek-v4.1-flash";
const context: Context = { systemPrompt: "caller security policy", messages: [{ role: "user", content: "owned input", timestamp: 1 }] };
const result = () => new Response('data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
const keys = ["AXIOM_EXECUTION_PROFILE", "AXIOM_MODEL_ACCOUNT_BINDINGS", "AXIOM_MODEL_MANAGED_ACCOUNTS", "CODEBUDDY_CN_API_KEY"];
const saved = keys.map(key => process.env[key]); const originalFetch = globalThis.fetch;
before(() => { keys.forEach(key => delete process.env[key]); globalThis.fetch = async () => { throw Error("Unexpected external fetch"); }; });
after(() => { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); globalThis.fetch = originalFetch; });
async function fixture(config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "codebuddy-pi-")); const modelsPath = join(root, "models.json");
  writeFileSync(modelsPath, JSON.stringify({ providers: { [id]: config } }));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(id, async () => ({ type: "api_key", key: "SYNTHETIC-A" }));
  const runtime = await createModelRuntime({ providerIds: [id], modelsPath, authPath: join(root, "auth.json"), credentials, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
  return { runtime, credentials, model: runtime.getModel(id, modelId)!, close() { (runtime.getRegisteredNativeProvider(id) as ReturnType<typeof codeBuddyProvider>).dispose(); rmSync(root, { recursive: true, force: true }); } };
}

test("normal SDK auth re-resolves opaque tickets for each physical request, including stale summary options", async () => {
  const f = await fixture(); let calls = 0;
  try {
    const auth = await f.runtime.getAuth(f.model); assert.ok(auth?.auth.apiKey?.startsWith(CODEBUDDY_TICKET_PREFIX));
    const fetch: typeof globalThis.fetch = async (_url, init) => { calls++; assert.equal(new Headers(init?.headers).get("authorization"), "Bearer SYNTHETIC-A"); return result(); };
    for (let i = 0; i < 2; i++) {
      const message = await f.runtime.streamSimple(f.model, context, { ...auth?.auth, fetch, reasoning: undefined, maxRetries: 0 }).result();
      assert.equal(message.stopReason, "stop", message.errorMessage);
    }
    assert.equal(calls, 2);
  } finally { f.close(); }
});

test("native tickets are single-use, expire, and become unusable after invalidation or disposal", async () => {
  const chat = codeBuddyChat({ oauth: { toAuth: async () => ({ apiKey: "unused" }) } as any });
  const credential = { type: "oauth" as const, access: "SYNTHETIC", refresh: "UNUSED", expires: Date.now() + 100000 };
  const issue = async () => (await chat.auth.oauth!.toAuth(credential)).apiKey!;
  const first = await issue(); assert.equal(chat.consumeAccess(first), "SYNTHETIC"); assert.throws(() => chat.consumeAccess(first));
  const expired = await issue(), now = Date.now; Date.now = () => now() + 61000;
  try { assert.throws(() => chat.consumeAccess(expired)); } finally { Date.now = now; }
  const invalidated = await issue(); chat.invalidate(); assert.throws(() => chat.consumeAccess(invalidated));
  const disposed = await issue(); chat.dispose(); assert.throws(() => chat.consumeAccess(disposed)); await assert.rejects(issue);
});

test("configured base/API/unknown model cannot leave native routing; failed header commands are redacted", async () => {
  for (const config of [{ baseUrl: "https://foreign.invalid/v2" }, { api: "openai-responses", models: [{ id: modelId, api: "openai-responses", contextWindow: 10000, maxTokens: 500 }] }, { headers: { "X-Fixture": "!false PRIVATE_COMMAND_MARKER" } }]) {
    const f = await fixture(config); let sent = 0;
    try {
      if (config.api) assert.equal(f.model.api, config.api, "fixture must actually select the overridden API");
      const response = await f.runtime.streamSimple(f.model, context, { apiKey: "EXPLICIT", fetch: async () => { sent++; return result(); } }).result();
      assert.equal(response.stopReason, "error", JSON.stringify(config)); assert.equal(sent, 0); assert.ok(!response.errorMessage?.includes("PRIVATE_COMMAND_MARKER"));
      if (config.headers) assert.match(response.errorMessage!, /认证或请求头配置解析失败/);
    } finally { f.close(); }
  }
  const f = await fixture(); let sent = 0;
  try {
    const response = await f.runtime.streamSimple({ ...f.model, id: "not-declared" }, context, { fetch: async () => { sent++; return result(); } }).result();
    assert.equal(response.stopReason, "error"); assert.equal(sent, 0);
  } finally { f.close(); }
});

test("SDK catalog redeems API-key handoff and isolates cloud-only models on credential switch and logout", async () => {
  const f = await fixture(); const oldFetch = globalThis.fetch; const seen: string[] = [];
  globalThis.fetch = async (url, init) => { assert.equal(String(url), "https://copilot.tencent.com/v3/config"); assert.equal(init?.method, "GET");
    seen.push(new Headers(init.headers).get("authorization")!);
    return Response.json({ data: { models: [{ id: "cloud-only", name: "Cloud", maxInputTokens: 10000, maxOutputTokens: 1000 }], availableModels: [modelId, "cloud-only"] } }); };
  try {
    const refresh = await f.runtime.refresh({ providers: [id], allowNetwork: true, force: true }); assert.equal(refresh.errors.size, 0);
    assert.deepEqual(seen, ["Bearer SYNTHETIC-A"]); assert.ok(f.runtime.getModels(id).some(model => model.id === "cloud-only"));
    assert.ok((await f.runtime.getAvailable(id)).some(model => model.id === "cloud-only"));
    await f.credentials.modify(id, async () => ({ type: "api_key", key: "SYNTHETIC-B" }));
    assert.ok(!(await f.runtime.getAvailable(id)).some(model => model.id === "cloud-only"));
    await f.runtime.refresh({ providers: [id], allowNetwork: false }); assert.ok(!f.runtime.getModels(id).some(model => model.id === "cloud-only"));
    await f.credentials.delete(id); assert.equal((await f.runtime.getAvailable(id)).length, 0);
  } finally { globalThis.fetch = oldFetch; f.close(); }
});

test("SDK env-only key keeps the current cloud catalog without a stored credential", async () => {
  const f = await fixture(); await f.credentials.delete(id); process.env.CODEBUDDY_CN_API_KEY = "SYNTHETIC-ENV";
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => { assert.equal(new Headers(init?.headers).get("authorization"), "Bearer SYNTHETIC-ENV");
    return Response.json({ data: { models: [{ id: "ambient-cloud", name: "Cloud", maxInputTokens: 10000, maxOutputTokens: 1000 }] } }); };
  try {
    await f.runtime.refresh({ providers: [id], allowNetwork: false });
    const refresh = await f.runtime.refresh({ providers: [id], allowNetwork: true }); assert.equal(refresh.errors.size, 0);
    assert.ok((await f.runtime.getAvailable(id)).some(model => model.id === "ambient-cloud"));
    delete process.env.CODEBUDDY_CN_API_KEY;
    await f.runtime.refresh({ providers: [id], allowNetwork: false }); assert.equal((await f.runtime.getAvailable(id)).length, 0);
  } finally { delete process.env.CODEBUDDY_CN_API_KEY; globalThis.fetch = oldFetch; f.close(); }
});

test("observer binds native transport identity and retains run identity without falling back to generic fetch", async () => {
  const f = await fixture(), tracker = new ProviderRequestTracker(); let sent = 0;
  try {
    assert.equal(providerRequestDefaultTransport(f.runtime, f.model), codeBuddyNativeFetch);
    const provider = f.runtime.getRegisteredNativeProvider(id)!, saved = provider.streamSimple;
    provider.streamSimple = () => { throw Error("extension override"); };
    assert.equal(providerRequestDefaultTransport(f.runtime, f.model), undefined); provider.streamSimple = saved;
    const wrapped = observeProviderRequests(f.runtime.streamSimple.bind(f.runtime), event => tracker.observe("fixture", event),
      (model, options) => providerRequestHttpTransport(f.runtime, model, options), model => {
        assert.equal(providerRequestDefaultTransport(f.runtime, model), codeBuddyNativeFetch);
        // This test verifies registry/observer wiring; actual Node sender is separately loopback-tested.
        return async (_url, init) => { sent++; assert.equal(tracker.snapshot().providers[0].current, 1);
          const headers = new Headers(init?.headers);
          assert.match(headers.get("x-conversation-id")!, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
          assert.match(headers.get("x-conversation-request-id")!, /^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/); return result(); };
      });
    const response = await wrapped(f.model, context, withCodeBuddyRunIdentity(f.model, { sessionId: "session" }, { sessionId: "session", continuationId: "run" })).result();
    assert.equal(response.stopReason, "stop", response.errorMessage); assert.equal(sent, 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(tracker.snapshot().providers, [{ providerId: id, current: 0, peak: 1, rpm: 1, callLevel: false }]);
  } finally { f.close(); }
});

test("SDK refresh generation rejects late publication from a replaced account", { timeout: 5000 }, async () => {
  const f = await fixture(), oldFetch = globalThis.fetch;
  let finishFirst!: (response: Response) => void, started!: () => void, calls = 0, lateClosed = false;
  const beginning = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = async (_url, init) => {
    if (++calls === 1) { assert.equal(new Headers(init?.headers).get("authorization"), "Bearer SYNTHETIC-A"); started(); return new Promise(resolve => { finishFirst = resolve; }); }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer SYNTHETIC-B");
    return Response.json({ data: { models: [{ id: "new-account-cloud", maxInputTokens: 10000, maxOutputTokens: 1000 }] } });
  };
  try {
    const first = f.runtime.refresh({ providers: [id], allowNetwork: true }); await beginning;
    await f.credentials.modify(id, async () => ({ type: "api_key", key: "SYNTHETIC-B" }));
    const next = await f.runtime.refresh({ providers: [id], allowNetwork: true }); assert.equal(next.errors.size, 0);
    finishFirst(new Response(new ReadableStream({ cancel() { lateClosed = true; } })));
    await first; await new Promise(resolve => setImmediate(resolve));
    assert.equal(lateClosed, true); assert.ok(f.runtime.getModels(id).some(model => model.id === "new-account-cloud")); assert.equal(calls, 2);
  } finally { globalThis.fetch = oldFetch; f.close(); }
});

test("provider disposal cancels uncooperative SDK acquisition and closes its late body", async () => {
  const provider = codeBuddyProvider(), models = createModels(); models.setProvider(provider);
  let resolveResponse!: (response: Response) => void, started!: () => void, lateClosed = false;
  const beginning = new Promise<void>(resolve => { started = resolve; });
  const stream = models.streamSimple(provider.getModels()[0], context, { apiKey: "SYNTHETIC", fetch: async () => { started(); return new Promise(resolve => { resolveResponse = resolve; }); } });
  await beginning; provider.dispose(); assert.equal((await stream.result()).stopReason, "aborted");
  resolveResponse(new Response(new ReadableStream({ cancel() { lateClosed = true; } })));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(lateClosed, true);
});

test("malformed identity metadata is rejected rather than silently ignored", async () => {
  const provider = codeBuddyProvider(), models = createModels(); models.setProvider(provider); const model = provider.getModels().find(model => model.id === modelId)!;
  let sent = 0;
  try { for (const identity of [7, [], "PRIVATE_BAD_ID", { invocationId: "bad\nPRIVATE_BAD_ID" }, { unknownIdentity: "PRIVATE_BAD_ID" }]) {
    const response = await models.completeSimple(model, context, { apiKey: "SYNTHETIC", metadata: { [CODEBUDDY_IDENTITY_METADATA]: identity }, fetch: async () => { sent++; return result(); } });
    assert.equal(response.stopReason, "error"); assert.ok(!response.errorMessage?.includes("PRIVATE_BAD_ID"));
  } assert.equal(sent, 0); } finally { provider.dispose(); }
});
