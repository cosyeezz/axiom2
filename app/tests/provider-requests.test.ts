import assert from "node:assert/strict";
import { test } from "node:test";
import { createAssistantMessageEventStream, normalizeContext, type AssistantMessage, type Model, type Provider } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { observeProviderRequests, providerRequestHttpTransport, recognizeProviderRequestTransport } from "../src/server/provider-request-observer.js";
import { ProviderRequestTracker } from "../src/server/provider-request-statistics.js";
import type { ProviderRequestEvent } from "../src/shared/provider-requests.js";
import { kiroChat } from "../src/server/providers/kiro-chat.js";
import { kiroOAuth } from "../src/server/providers/kiro-auth.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";

const model = { id: "test", provider: "vendor", api: "openai-completions" } as Model<"openai-completions">;
const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text: "ok" }], provider: "vendor", model: "test", api: model.api, stopReason: "stop", timestamp: 1,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
const context = normalizeContext({ messages: [] });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const start = (id: string, provider = "vendor", precision: "http" | "call" = "http"): ProviderRequestEvent => ({ type: "provider_request_stat", phase: "start", id, provider, precision });
const end = (id: string): ProviderRequestEvent => ({ type: "provider_request_stat", phase: "end", id });

test("connection isolation, idempotent cleanup, startup peaks and exact rolling60s (no extrapolation)", () => {
  let now = 0; const tracker = new ProviderRequestTracker(() => now);
  tracker.observe("worker-1", start("a")); tracker.observe("worker-1", start("a"));
  tracker.observe("worker-2", start("a")); tracker.observe("worker-1", start("b", "other", "call"));
  assert.deepEqual(tracker.snapshot().providers, [
    { providerId: "vendor", current: 2, peak: 2, rpm: 2, callLevel: false },
    { providerId: "other", current: 1, peak: 1, rpm: 1, callLevel: true },
  ]);
  tracker.observe("worker-1", end("a")); tracker.observe("worker-1", end("a"));
  tracker.releaseOwner("worker-1"); tracker.releaseOwner("worker-1");
  now = 59_999; assert.equal(tracker.snapshot().providers[0].rpm, 2);
  tracker.observe("worker-2", start("later"));
  now = 60_000; assert.deepEqual(tracker.snapshot().providers[0], { providerId: "vendor", current: 2, peak: 2, rpm: 1, callLevel: false });
  tracker.releaseOwner("worker-2"); tracker.observe("worker-2", end("later"));
  assert.equal(tracker.snapshot().providers[0].current, 0);
  assert.equal(tracker.snapshot().providers[0].peak, 2);
  now = 120_000; assert.equal(tracker.snapshot().providers[0].rpm, 0);
  assert.deepEqual(new ProviderRequestTracker().snapshot().providers, []);
});

test("HTTP retry backoff releases rejection and network failures; streams stay active until completion", async () => {
  const tracker = new ProviderRequestTracker(), events: ProviderRequestEvent[] = [];
  const emit = (event: ProviderRequestEvent) => { events.push(event); tracker.observe("worker", event); };
  const output = createAssistantMessageEventStream();
  let proceed!: () => void, released!: () => void;
  const response = new Response("stream-body", { status: 200 });
  let attempt = 0, callbackCount = 0;
  const wrapped = observeProviderRequests(async (_model, _context, options) => {
    await options!.onPayload!({ secret: "NOT_IN_EVENTS" }, model);
    const rejected = await options!.fetch!("http://fixture");
    assert.equal(rejected.status, 429);
    assert.equal(tracker.snapshot().providers[0].current, 0);
    try { await options!.fetch!("http://fixture"); assert.fail("network failure"); } catch { /* expected */ }
    assert.equal(tracker.snapshot().providers[0].current, 0);
    released(); await new Promise<void>(resolve => { proceed = resolve; });
    const received = await options!.fetch!("http://fixture"); assert.equal(received, response, "never replace/buffer the Response");
    return output;
  }, emit, () => true);
  const backoff = new Promise<void>(resolve => { released = resolve; });
  const promise = wrapped(model, context, { onPayload: () => { callbackCount++; }, fetch: async () => {
    attempt++; if (attempt === 1) return new Response("limited", { status: 429 });
    if (attempt === 2) throw Error("network"); return response;
  } });
  await backoff; assert.equal(tracker.snapshot().providers[0].rpm, 2);
  proceed(); const stream = await promise; assert.equal(stream, output);
  assert.equal(tracker.snapshot().providers[0].current, 1);
  output.push({ type: "done", reason: "stop", message }); output.end(); await tick();
  assert.equal(callbackCount, 1); assert.equal(tracker.snapshot().providers[0].current, 0);
  assert.equal(tracker.snapshot().providers[0].rpm, 3);
  assert.equal(tracker.snapshot().providers[0].peak, 1);
  const seen = []; for await (const event of stream) seen.push(event.type);
  assert.deepEqual(seen, ["done"], "observer must not consume stream events");
  assert.equal(response.bodyUsed, false); assert.doesNotMatch(JSON.stringify(events), /NOT_IN_EVENTS|http:\/\/fixture/);
});

test("unsupported fetch adapters remain untouched; call-level precision is explicit, cancellation ends the call", async () => {
  const tracker = new ProviderRequestTracker(); const output = createAssistantMessageEventStream();
  const wrapped = observeProviderRequests(async (_model, _context, options) => {
    assert.equal(options?.fetch, undefined);
    await options?.onPayload?.({}, model); return output;
  }, event => tracker.observe("worker", event), () => false);
  const stream = await wrapped(model, context, undefined);
  assert.deepEqual(tracker.snapshot().providers[0], { providerId: "vendor", current: 1, peak: 1, rpm: 1, callLevel: true });
  output.push({ type: "error", reason: "aborted", error: { ...message, stopReason: "aborted" } }); output.end(); await stream.result(); await tick();
  assert.equal(tracker.snapshot().providers[0].current, 0);
});

test("local payload failures do not count; synchronous and asynchronous failures release observations", async () => {
  const tracker = new ProviderRequestTracker(); const emit = (event: ProviderRequestEvent) => tracker.observe("worker", event);
  const failPayload = observeProviderRequests(async (_model, _context, options) => {
    await options!.onPayload!({}, model); throw Error("unused");
  }, emit, () => false);
  await assert.rejects(async () => failPayload(model, context, { onPayload: () => { throw Error("local payload failure"); } }), /local payload/);
  assert.deepEqual(tracker.snapshot().providers, []);
  const throws = observeProviderRequests<StreamFn>(() => { throw Error("sync"); }, () => { throw Error("statistics sink"); }, () => true);
  assert.throws(() => throws(model, context), /sync/);
  const failsAfterPayload = observeProviderRequests(async (_model, _context, options) => {
    await options!.onPayload!({}, model); throw Error("async");
  }, emit, () => false);
  await assert.rejects(async () => failsAfterPayload(model, context, undefined), /async/); await tick();
  assert.equal(tracker.snapshot().providers[0].current, 0);
});

test("observer preserves runtime signatures and exact synchronous stream or asynchronous promise identity", async () => {
  const output = createAssistantMessageEventStream();
  const base: ModelRuntime["stream"] = (_model, _context, _options) => output;
  const wrapped: ModelRuntime["stream"] = observeProviderRequests(base, () => {}, () => false);
  const simple: ModelRuntime["streamSimple"] = observeProviderRequests(base, () => {}, () => false);
  // Runtime entry points accept raw Context and must keep a synchronous return type.
  const stream: ReturnType<typeof createAssistantMessageEventStream> = wrapped(model, { messages: [] }, { temperature: 0 });
  assert.equal(stream, output);
  assert.equal(simple(model, { messages: [] }), output);
  const expected = Promise.resolve(output);
  const asynchronous = observeProviderRequests((..._args: Parameters<StreamFn>) => expected, () => {}, () => false);
  const promise: typeof expected = asynchronous(model, context);
  assert.equal(promise, expected, "observation must not replace the original promise");
  output.end(message);
  assert.equal(await promise, output);
  await tick();
});

test("virtual routing is observed only at its physical runtime dispatch", async () => {
  let hooks = 0; const output = createAssistantMessageEventStream(); output.push({ type: "done", reason: "stop", message }); output.end();
  const wrapped = observeProviderRequests((_model, _context, options) => { assert.equal(options?.onPayload, undefined); return output; }, () => { hooks++; }, () => { assert.fail("virtual model must route first"); });
  assert.equal(await wrapped({ ...model, api: "pi-virtual" }, context, undefined), output); assert.equal(hooks, 0);
});

test("late hooks and HTTP dispatch after completion never resurrect concurrency or block the original call", async () => {
  for (const custom of [false, true]) for (const http of [false, true]) {
    const tracker = new ProviderRequestTracker(), output = createAssistantMessageEventStream();
    let resume!: () => void, late!: Promise<void>, fetched = 0, customResults = 0;
    if (custom) output.result = () => { customResults++; throw Error("must remain untouched"); };
    const wrapped = observeProviderRequests((_model, _context, options) => {
      late = (async () => {
        assert.equal(await options!.onPayload!({}, model), "original replacement");
        if (http) await options!.fetch!("http://fixture/late");
      })();
      return output;
    }, event => tracker.observe("worker", event), () => http);
    assert.equal(wrapped(model, context, { onPayload: () => new Promise(resolve => { resume = () => resolve("original replacement"); }), fetch: async () => { fetched++; return new Response("original"); } }), output);
    output.end({ ...message, stopReason: "aborted" }); await tick();
    resume(); await late; await tick();
    assert.equal(customResults, 0); assert.equal(fetched, http ? 1 : 0, "actual transport is never suppressed by statistics");
    assert.deepEqual(tracker.snapshot().providers, [], "no late start, ghost concurrency or false RPM after observation ended");
  }
});

test("HTTP classification preserves extension overrides, native identities and WebSocket transport defaults", () => {
  let native: Provider | undefined, override = false;
  const runtime = { getRegisteredNativeProvider: () => native, getRegisteredProviderConfig: () => override ? { streamSimple: () => createAssistantMessageEventStream() } : undefined };
  assert.equal(providerRequestHttpTransport(runtime, model, undefined), true);
  assert.equal(providerRequestHttpTransport(runtime, { ...model, api: "google-generative-ai" }, undefined), false);
  assert.equal(providerRequestHttpTransport(runtime, { ...model, api: "openai-codex-responses" }, undefined), false);
  assert.equal(providerRequestHttpTransport(runtime, { ...model, api: "openai-codex-responses" }, { transport: "sse" }), true);
  const original = getApiProvider(model.api)!, raw = original.stream;
  original.stream = () => createAssistantMessageEventStream();
  try { assert.equal(providerRequestHttpTransport(runtime, model, undefined), false, "raw stream overrides also keep their default fetch"); }
  finally { original.stream = raw; }
  assert.equal(providerRequestHttpTransport(runtime, model, undefined), true, "test cleanup restores the exact original identity");
  native = kiroProvider(); const kiro = { ...model, provider: "kiro", api: "kiro-chat" };
  assert.equal(providerRequestHttpTransport(runtime, kiro, undefined), false, "provider IDs alone do not establish transport safety");
  recognizeProviderRequestTransport(native);
  assert.equal(providerRequestHttpTransport(runtime, kiro, undefined), true);
  override = true; assert.equal(providerRequestHttpTransport(runtime, kiro, undefined), false);
  override = false; native.streamSimple = () => createAssistantMessageEventStream();
  assert.equal(providerRequestHttpTransport(runtime, kiro, undefined), false, "mutating a recognized native provider invalidates its identity");
});

test("real Kiro enterprise profile discovery is not inference, including discovery failures", async () => {
  for (const denied of [false, true]) {
    const tracker = new ProviderRequestTracker(), provider = kiroChat(kiroOAuth());
    const auth = await provider.auth.toAuth({ type: "oauth", access: `isolated-${denied}`, refresh: "unused", expires: Date.now() + 3600000, authMethod: "identity-center", authRegion: "us-east-1" });
    let discovery = 0, inference = 0;
    const wrapped = observeProviderRequests((m, c, o) => provider.stream(m, c, o), event => tracker.observe("worker", event), () => true);
    const stream = wrapped({ ...model, provider: "kiro", api: "kiro-chat", input: ["text"] }, normalizeContext({ messages: [{ role: "user", content: "test", timestamp: 1 }] }), { ...auth, fetch: async (_url, init) => {
      const discoveryRequest = new Headers(init?.headers).get("x-amz-target")?.endsWith("ListAvailableProfiles");
      if (discoveryRequest) {
        discovery++; assert.deepEqual(tracker.snapshot().providers, []);
        return denied ? new Response("denied", { status: 403 }) : Response.json({ profiles: [{ arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/test" }] });
      }
      inference++; assert.equal(tracker.snapshot().providers[0].current, 1);
      return kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" })]);
    } });
    assert.equal((await stream.result()).stopReason, denied ? "error" : "stop"); await tick();
    assert.equal(discovery, 1); assert.equal(inference, denied ? 0 : 1);
    assert.deepEqual(tracker.snapshot().providers, denied ? [] : [{ providerId: "kiro", current: 0, peak: 1, rpm: 1, callLevel: false }]);
  }
});

test("HTTP preparation fetches are excluded and arbitrary result overrides remain untouched", async () => {
  const tracker = new ProviderRequestTracker(), output = createAssistantMessageEventStream();
  let resultCalls = 0, transportCalls = 0;
  output.result = () => { resultCalls++; throw Error("custom completion side effect"); };
  const fetcher: typeof fetch = async () => { transportCalls++; return new Response("untouched"); };
  const wrapped = observeProviderRequests(async (_model, _context, options) => {
    const profile = await options!.fetch!("http://fixture/profile"); assert.equal(profile.bodyUsed, false);
    assert.deepEqual(tracker.snapshot().providers, [], "pre-payload enterprise profile/auth/catalog fetch does not count");
    await options!.onPayload!({}, model);
    await options!.fetch!("http://fixture/inference");
    assert.equal(tracker.snapshot().providers[0].current, 1);
    return output;
  }, event => tracker.observe("worker", event), () => true);
  assert.equal(await wrapped(model, context, { fetch: fetcher }), output); await tick();
  assert.equal(resultCalls, 0); assert.equal(transportCalls, 2);
  assert.deepEqual(tracker.snapshot().providers[0], { providerId: "vendor", current: 0, peak: 1, rpm: 1, callLevel: false });
});
