import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchKiroCatalog } from "../src/server/providers/kiro-catalog.js";
import { kiroProvider } from "../src/server/providers/kiro.js";
import type { KiroCredential } from "../src/server/providers/kiro-auth.js";

const credential = (): KiroCredential => ({ type: "oauth", access: "ACCESS-PRIVATE", refresh: "REFRESH-PRIVATE",
  expires: Date.now() + 3600_000, authMethod: "builder-id", authRegion: "us-east-1" });
const model = { modelId: "partial-only", tokenLimits: { maxInputTokens: 4096, maxOutputTokens: 512 } };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// This watchdog is independent of production timers, so regressions fail rather than hang.
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("catalog did not settle within the test deadline")), 1000);
    })]);
  } finally { clearTimeout(timer); }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test("catalog abort bounds a signal-ignoring fetch and cancels its late body without waiting for cleanup", async () => {
  const response = deferred<Response>(), started = deferred<void>(), abort = new AbortController();
  let calls = 0, cancellations = 0;
  const pending = fetchKiroCatalog(credential(), abort.signal, async () => {
    calls++; started.resolve(); return response.promise;
  });
  await started.promise;
  const reason = new DOMException("catalog cancelled", "AbortError");
  abort.abort(reason);
  await assert.rejects(bounded(pending), error => error === reason);
  response.resolve(new Response(new ReadableStream({ cancel() { cancellations++; return new Promise(() => {}); } })));
  await tick();
  assert.equal(calls, 1); assert.equal(cancellations, 1);
});

test("catalog observes late transport rejection after cancellation without leaking its secret", async () => {
  const response = deferred<Response>(), abort = new AbortController();
  const pending = fetchKiroCatalog(credential(), abort.signal, async () => response.promise);
  abort.abort();
  await assert.rejects(bounded(pending), /abort/i);
  response.reject(Error("ACCESS-PRIVATE late network failure"));
  await tick(); // node:test also fails on unhandled rejections.
});

test("catalog abort bounds a stalled body even when reader cancellation never settles", async () => {
  const reading = deferred<void>(), abort = new AbortController();
  let cancellations = 0;
  const pending = fetchKiroCatalog(credential(), abort.signal, async () => new Response(new ReadableStream({
    pull() { reading.resolve(); return new Promise(() => {}); },
    cancel() { cancellations++; return new Promise(() => {}); },
  })));
  await reading.promise; await tick();
  const reason = new DOMException("catalog deadline", "TimeoutError");
  abort.abort(reason);
  await assert.rejects(bounded(pending), error => error === reason);
  assert.equal(cancellations, 1);
});

test("catalog HTTP and declared-size failures do not wait for an uncooperative body cancel", async () => {
  for (const kind of ["http", "declared-size"] as const) {
    let cancellations = 0, calls = 0;
    const pending = fetchKiroCatalog(credential(), new AbortController().signal, async () => {
      calls++;
      return new Response(new ReadableStream({ cancel() { cancellations++; return new Promise(() => {}); } }),
        kind === "http" ? { status: 403 } : { headers: { "content-length": "2097153" } });
    });
    await assert.rejects(bounded(pending), kind === "http" ? /无权/ : /2 MiB/);
    assert.equal(calls, 1); assert.equal(cancellations, 1);
  }
});

test("catalog streamed-size failure does not wait for a stalled reader cancel", async () => {
  let cancellations = 0;
  const pending = fetchKiroCatalog(credential(), new AbortController().signal, async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2097153)); },
    cancel() { cancellations++; return new Promise(() => {}); },
  })));
  await assert.rejects(bounded(pending), /2 MiB/);
  assert.equal(cancellations, 1);
});

test("catalog timeout on a later page neither publishes partial models nor persists a cache", async () => {
  const waiting = deferred<void>(), abort = new AbortController();
  let calls = 0, persisted = 0;
  const provider = kiroProvider({ fetch: async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify({ models: [model], defaultModel: model, nextToken: "next" }));
    waiting.resolve(); return new Promise(() => {});
  } });
  const refreshModels = provider.refreshModels;
  assert.ok(refreshModels);
  const context: Parameters<typeof refreshModels>[0] = {
    credential: credential(), allowNetwork: true, signal: abort.signal,
    publish: async ({ update, persist }) => { if (persist) persisted++; update?.(); return true; },
  };
  const pending = refreshModels(context);
  await waiting.promise;
  abort.abort(new DOMException("catalog deadline", "TimeoutError"));
  await assert.rejects(bounded(pending), /catalog deadline/);
  assert.equal(calls, 2); assert.equal(persisted, 0);
  assert.deepEqual(provider.getModels(), []);
  assert.equal(provider.catalogState().refresh, "failed");
});

test("catalog already-aborted requests make no physical fetch", async () => {
  const abort = new AbortController(); abort.abort();
  let calls = 0;
  await assert.rejects(bounded(fetchKiroCatalog(credential(), abort.signal, async () => {
    calls++; throw Error("MUST NOT FETCH");
  })), /abort/i);
  assert.equal(calls, 0);
});
