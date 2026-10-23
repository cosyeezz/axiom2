import assert from "node:assert/strict";
import { test } from "node:test";
import { LatencyBuffer } from "../src/shared/latency.js";
import { ModelLatency, latencyError } from "../src/server/model-latency.js";
import { browserLatency, receiveDelivery, commitDelivery } from "../src/client/latency.js";
import { boundedMessage } from "../src/server/transcript.js";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { getApiProvider, registerApiProvider, resetApiProviders } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@earendil-works/pi-ai";

test("diagnostics retain only bounded metadata and return independent snapshots", () => {
  const buffer = new LatencyBuffer(2);
  for (let i = 0; i < 4; i++) buffer.add({ stage: "test", at: i, runId: "r", body: "SECRET", headers: "SECRET" } as any);
  const records = buffer.snapshot();
  assert.deepEqual(records.map(r => r.at), [2, 3]);
  assert.doesNotMatch(JSON.stringify(records), /SECRET|body|headers/);
  records[0].stage = "changed";
  assert.equal(buffer.snapshot()[0].stage, "test");
  assert.deepEqual(buffer.snapshot("other"), []);
});

test("model observation composes custom fetch and callbacks without reading bodies or changing cancellation", async () => {
  const records = new LatencyBuffer(), observer = new ModelLatency("r", record => records.add(record));
  const controller = new AbortController(), response = new Response("BODY_SENTINEL", { status: 503 });
  let fetched = 0, payloads = 0, responses = 0, events = 0;
  const model = { api: "openai-responses" } as any;
  const base: StreamFn = (async (m: any, _context: any, options: any) => {
    assert.equal(options.signal, controller.signal);
    assert.deepEqual(await options.onPayload({ secret: "PAYLOAD_SENTINEL" }, m), { replaced: true });
    assert.equal(await options.fetch("http://unused.invalid", { signal: controller.signal }), response);
    assert.equal(response.bodyUsed, false);
    await options.onResponse({ status: 503, headers: { authorization: "HEADER_SENTINEL" } }, m);
    await options.onProviderStreamEvent({ text: "EVENT_SENTINEL" }, m);
    await options.onProviderStreamEvent({ text: "EVENT_SENTINEL" }, m);
    const stream = createAssistantMessageEventStream();
    stream.end({ role: "assistant", stopReason: "error", errorMessage: "server_error overloaded SECRET", timestamp: Date.now() } as any);
    return stream;
  }) as StreamFn;
  const completed = await observer.wrap(base)(model, {} as any, {
    signal: controller.signal,
    fetch: async (_input, init) => { fetched++; assert.equal(init?.signal, controller.signal); return response; },
    onPayload: () => { payloads++; return { replaced: true }; },
    onResponse: () => { responses++; }, onProviderStreamEvent: () => { events++; },
  });
  await completed.result();
  assert.deepEqual([fetched, payloads, responses, events], [1, 1, 1, 2]);
  observer.first("text"); observer.first("text");
  assert.equal(records.snapshot().filter(r => r.stage === "model.first_event").length, 1);
  assert.equal(records.snapshot().filter(r => r.stage === "model.first_text").length, 1);
  assert.equal(records.snapshot().find(r => r.stage === "model.end")?.code, "overloaded");
  assert.doesNotMatch(JSON.stringify(records.snapshot()), /SENTINEL|SECRET|unused.invalid/);
  const failing: StreamFn = (async (_m: any, _c: any, options: any) => options.fetch("http://unused.invalid")) as StreamFn;
  const abort = new Error("cancelled SECRET");
  await assert.rejects(Promise.resolve(observer.wrap(failing)(model, {} as any, { fetch: async () => { throw abort; } })), error => error === abort);
  assert.equal(records.snapshot().at(-1)?.code, "cancelled");
  assert.equal(latencyError("429 rate limit SECRET"), "rate_limit");
});

test("custom transport defaults survive and request completion is observed without consuming summary streams", async () => {
  const records = new LatencyBuffer(), observer = new ModelLatency("completion-test", record => records.add(record));
  const streams: AssistantMessageEventStream[] = [];
  const customFetch = async () => new Response("synthetic");
  const wrapped = observer.wrap((_model, _context, options) => {
    assert.equal(options?.fetch ?? customFetch, customFetch, "missing fetch must keep the custom provider default");
    const stream = createAssistantMessageEventStream(); streams.push(stream); return stream;
  }, { sessionId: "main-session" });
  const model = { api: "openai-completions" } as any;
  const reply = wrapped(model, {} as any, { sessionId: "main-session" });
  const summary = wrapped(model, {} as any);
  assert.equal(reply, streams[0]); assert.equal(summary, streams[1]);
  const message = { role: "assistant", stopReason: "stop", content: [], timestamp: Date.now() } as any;
  streams[1].push({ type: "done", reason: "stop", message }); streams[1].end();
  assert.equal(await streams[1].result(), message);
  assert.equal((await streams[1][Symbol.asyncIterator]().next()).value.message, message, "observation does not consume events");
  assert.equal(observer.delivery()?.requestId, "completion-test:1", "summary does not replace active reply correlation");
  streams[0].end({ ...message, stopReason: "aborted" });
  await streams[0].result();
  const failure = new Error("timeout SECRET");
  assert.throws(() => observer.wrap(() => { throw failure; })(model, {} as any), error => error === failure);
  const end = records.snapshot().filter(r => r.stage === "model.end");
  assert.deepEqual(end.map(r => [r.requestId, r.purpose, r.code]), [
    ["completion-test:2", "auxiliary", "ok"], ["completion-test:1", "session", "cancelled"], ["completion-test:3", "session", "timeout"],
  ]);
  assert.doesNotMatch(JSON.stringify(records.snapshot()), /SECRET|synthetic/);
});

test("compat API overrides and custom result methods retain their own defaults and side effects", () => {
  const observer = new ModelLatency("custom-test", () => {}), model = { api: "openai-completions" } as any;
  let resultCalls = 0;
  const customStream = createAssistantMessageEventStream();
  customStream.result = () => { resultCalls++; throw Error("must not call custom result"); };
  const original = getApiProvider(model.api)!;
  registerApiProvider({ ...original, streamSimple: (_model, _context, options) => {
    assert.equal(options?.fetch, undefined, "compat override keeps its default fetch"); return customStream;
  } });
  try {
    const wrapped = observer.wrap((m, c, o) => getApiProvider(m.api)!.streamSimple(m, c, o), { defaultFetch: () => true });
    assert.equal(wrapped(model, {} as any), customStream);
    assert.equal(resultCalls, 0);
  } finally { resetApiProviders(); }
});

test("browser records exact-object commits once and historical projections omit transient timing", () => {
  const timing = { runId: "browser-test", requestId: "req", updateId: 1, workerAt: Date.now(), connectionId: "connection-test" };
  const message = { id: "m", role: "assistant" as const, text: "SECRET", deliveryTiming: timing };
  receiveDelivery(message, timing, "stream", 3, performance.now() - 25, 2);
  commitDelivery({ ...message });
  assert.equal(browserLatency.snapshot("browser-test").length, 1);
  commitDelivery(message); commitDelivery(message);
  const records = browserLatency.snapshot("browser-test");
  assert.equal(records.length, 2); assert.equal(records[1].stage, "browser.commit");
  assert.ok(records[1].durationMs! >= 25);
  assert.equal(records[1].connectionId, "connection-test");
  assert.doesNotMatch(JSON.stringify(records), /SECRET|workerAt/);
  assert.equal(boundedMessage(message).deliveryTiming, undefined);
});
