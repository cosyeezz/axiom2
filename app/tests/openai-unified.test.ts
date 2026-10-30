import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model, Message } from "@earendil-works/pi-ai";
import { closeOpenAICodexWebSocketSessions } from "@earendil-works/pi-ai/api/openai-codex-responses";
import { createModelRuntime } from "../src/server/model-runtime.js";
import { openAIProviderId, providerDisplayName } from "../src/shared/model-providers.js";
import { modelDisplay } from "../src/shared/model-display.js";
import { Logins } from "../src/server/auth.js";
import { ModelService } from "../src/server/model-service.js";
import { fixtureLoginNetwork } from "./model-network-fixture.js";

const user = (content: string): Message => ({ role: "user", content, timestamp: 1 });
// Invented JWT-format fixture, never a real token or account.
const access = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account" } })).toString("base64url")}.fixture`;
const credential = { type: "oauth" as const, access, refresh: "FIXTURE_REFRESH", expires: Date.now() + 86400000, accountId: "fixture-account" };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "axiom-openai-unified-")), dir = join(root, "pi"); mkdirSync(dir);
  const authPath = join(dir, "auth.json"), modelsPath = join(dir, "models.json"), modelsStorePath = join(dir, "models-store.json");
  writeFileSync(authPath, JSON.stringify({ [openAIProviderId]: credential, openai: { type: "api_key", key: "FIXTURE_LEGACY_KEY" } }));
  writeFileSync(modelsPath, '{"providers":{}}');
  const original = readFileSync(authPath, "utf8");
  return { root, dir, original, options: { authPath, modelsPath, modelsStorePath, providerIds: [openAIProviderId], refreshOnCreate: false, allowModelNetwork: false } };
}

test("an empty configuration offers OpenAI without eagerly registering a native provider", async t => {
  const f = fixture(); writeFileSync(f.options.authPath, "{}");
  t.mock.method(globalThis, "fetch", async () => assert.fail("cold configuration must not use network"));
  try {
    const service = new ModelService(f.root, null, f.dir);
    const runtime = await service.runtime(undefined, true);
    assert.equal(runtime.getRegisteredNativeProvider(openAIProviderId), undefined);
    const configuration = await service.read();
    const template = configuration.templates.find(provider => provider.id === openAIProviderId)!;
    assert.equal(template.name, "OpenAI"); assert.deepEqual(template.methods, ["oauth"]);
    assert.equal(readFileSync(f.options.authPath, "utf8"), "{}");
    assert.equal(existsSync(f.options.modelsStorePath), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("OpenAI keeps native Codex identity, OAuth and catalog without migrating direct credentials or writing metadata", async t => {
  const f = fixture();
  t.mock.method(globalThis, "fetch", async () => assert.fail("metadata must never use the network"));
  try {
    const runtime = await createModelRuntime({ ...f.options, metadataOnly: true });
    assert.equal(runtime.getProvider(openAIProviderId)?.name, "OpenAI");
    assert.equal(runtime.getProvider(openAIProviderId)?.id, openAIProviderId);
    assert.equal(runtime.getProvider(openAIProviderId)?.auth.apiKey, undefined);
    assert.ok(runtime.getProvider(openAIProviderId)?.auth.oauth?.login);
    assert.ok(runtime.getModels(openAIProviderId).length > 0);
    assert.ok(runtime.getModels(openAIProviderId).every(model => model.api === "openai-codex-responses" && model.provider === openAIProviderId));
    const codexAuth = await runtime.getAuth(openAIProviderId), directAuth = await runtime.getAuth("openai");
    assert.ok(codexAuth); assert.ok(directAuth);
    assert.equal(codexAuth.auth.apiKey, access);
    assert.equal(directAuth.auth.apiKey, "FIXTURE_LEGACY_KEY");
    assert.equal(readFileSync(f.options.authPath, "utf8"), f.original);
    assert.equal(existsSync(f.options.modelsStorePath), false);
    assert.equal(providerDisplayName(openAIProviderId), "OpenAI");
    assert.equal(modelDisplay([], { provider: openAIProviderId, id: "fixture-model" }).provider, "OpenAI");
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test("default OpenAI OAuth saves only the main Codex credential through the existing login flow", async t => {
  const f = fixture(), previous = process.env.AXIOM_PI_DIR; process.env.AXIOM_PI_DIR = f.dir;
  const service = new ModelService(f.root, null), runtime = await service.runtime();
  const native = runtime.getProvider(openAIProviderId)!;
  // Replace only the interaction with an offline fixture, never real OAuth.
  runtime.registerNativeProvider({ ...native, auth: { ...native.auth, oauth: {
    name: "Fixture Codex OAuth", login: async interaction => { assert.equal(await interaction.prompt({ type: "manual_code", message: "Fixture authorization code" }), "fixture-code"); return credential; },
    refresh: async value => value, toAuth: async value => ({ apiKey: value.access }),
  } } });
  await runtime.refresh({ allowNetwork: false });
  service.runtime = async () => runtime;
  const owner = {}, logins = new Logins(service, () => {}, async () => {}, async () => {}, fixtureLoginNetwork(service));
  t.mock.method(globalThis, "fetch", async () => assert.fail("fixture login must not use network"));
  try {
    const login = await logins.start(owner, openAIProviderId, "oauth", (await service.read()).revision);
    for (let n = 0; !logins.get(owner, login.id).state.prompt && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10));
    const prompt = logins.get(owner, login.id).state.prompt!; assert.ok(prompt);
    logins.answer(owner, login.id, prompt.id, "fixture-code");
    for (let n = 0; service.authActive && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(logins.get(owner, login.id).state.status, "completed");
    const auth = JSON.parse(readFileSync(f.options.authPath, "utf8"));
    assert.equal(auth[openAIProviderId].access, access); assert.equal(auth.openai.key, "FIXTURE_LEGACY_KEY");
    assert.equal(existsSync(join(f.root, "model-usage")), false);
  } finally { await logins.close(); if (previous === undefined) delete process.env.AXIOM_PI_DIR; else process.env.AXIOM_PI_DIR = previous; rmSync(f.root, { recursive: true, force: true }); }
});

test("runtime enforces cached WS for raw/simple inference, reuses native session delta, and preserves native fallback/cancel safety", { timeout: 15000 }, async t => {
  const f = fixture(), requests: any[] = [], sockets: FixtureSocket[] = [];
  let mode: "ready" | "handshake-fail" | "business" | "after-start" | "pending" = "ready", fetches = 0;
  const events = (id: string) => {
    const item = { type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: "fixture reply", annotations: [] }] };
    return [{ type: "response.created", response: { id } }, { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response: { id, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } }];
  };
  class FixtureSocket extends EventTarget {
    readyState = 0;
    constructor(url: string) {
      super(); assert.match(url, /^wss:\/\/chatgpt[.]com\/backend-api\/codex\/responses$/); sockets.push(this);
      setTimeout(() => { if (mode === "handshake-fail") this.dispatchEvent(new Event("error")); else { this.readyState = 1; this.dispatchEvent(new Event("open")); } }, 0);
    }
    send(value: string) {
      const request = JSON.parse(value); requests.push(request);
      setTimeout(() => {
        if (mode === "pending") return;
        if (mode === "business") { this.message({ type: "error", code: "usage_limit_reached", message: "fixture quota exhausted" }); return; }
        if (mode === "after-start") { this.message({ type: "response.created", response: { id: "resp_partial" } }); setTimeout(() => this.close(1006), 5); return; }
        events(`resp_${requests.length}`).forEach(event => this.message(event));
      }, 0);
    }
    message(value: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) })); }
    close(code = 1000) { this.readyState = 3; const event = new Event("close"); Object.assign(event, { code, reason: "fixture close", wasClean: code === 1000 }); this.dispatchEvent(event); }
  }
  t.mock.method(globalThis, "fetch", async () => {
    fetches++; assert.equal(mode, "handshake-fail", "only a pre-start transport failure may fall back to SSE");
    return new Response(events("resp_sse").map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  });
  const originalSocket = globalThis.WebSocket; globalThis.WebSocket = FixtureSocket as unknown as typeof WebSocket;
  try {
    const runtime = await createModelRuntime(f.options);
    const model = runtime.getModels(openAIProviderId)[0] as Model<"openai-codex-responses">;
    const sessionId = crypto.randomUUID(), first = user("first turn");
    const response = await runtime.stream(model, { messages: [first] }, { sessionId, transport: "sse", samplingParams: { service_tier: "priority" } }).result();
    assert.equal(response.stopReason, "stop"); assert.equal(fetches, 0); assert.equal(sockets.length, 1);
    assert.equal(requests[0].service_tier, "priority", "Codex must send request body overrides");
    const next = await runtime.streamSimple(model, { messages: [first, response, user("second turn")] }, { sessionId, transport: "websocket", samplingParams: { service_tier: "priority" } }).result();
    assert.equal(requests[1].service_tier, "priority");
    assert.equal(next.stopReason, "stop"); assert.equal(sockets.length, 1); assert.equal(requests[1].previous_response_id, response.responseId);
    assert.equal(requests[1].input.length, 1); assert.equal(requests[1].store, false); assert.equal(requests[1].type, "response.create");
    mode = "business";
    const denied = await runtime.streamSimple(model, { messages: [first] }, { sessionId: crypto.randomUUID() }).result();
    assert.equal(denied.stopReason, "error"); assert.equal(fetches, 0, "quota/business errors must never replay through SSE");
    mode = "after-start";
    const partial = await runtime.streamSimple(model, { messages: [first] }, { sessionId: crypto.randomUUID() }).result();
    assert.equal(partial.stopReason, "error"); assert.equal(fetches, 0, "started output must not transparently replay");
    mode = "pending";
    const controller = new AbortController(), before = requests.length;
    const pending = runtime.streamSimple(model, { messages: [first] }, { sessionId: crypto.randomUUID(), signal: controller.signal }).result();
    for (let n = 0; requests.length === before && n < 100; n++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(requests.length > before); controller.abort(); assert.equal((await pending).stopReason, "aborted"); assert.equal(fetches, 0);
    mode = "handshake-fail";
    const fallback = await runtime.streamSimple(model, { messages: [first] }, { sessionId: crypto.randomUUID() }).result();
    assert.equal(fallback.stopReason, "stop"); assert.equal(fetches, 1, "Pi's safe pre-start SSE fallback is deliberately retained");
    assert.equal(readFileSync(f.options.authPath, "utf8"), f.original);
  } finally { closeOpenAICodexWebSocketSessions(); globalThis.WebSocket = originalSocket; rmSync(f.root, { recursive: true, force: true }); }
});
