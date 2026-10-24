import { test } from "node:test";
import assert from "node:assert/strict";
import { maintenanceFetch } from "../src/shared/maintenance-runtime.js";
import { MaintenanceError, defaultMaintenanceBudgets } from "../src/shared/maintenance.js";

test("HTTP reads retry transient response failures at most twice, never mutate requests", async () => {
  let calls = 0, discarded = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return calls < 3 ? new Response(new ReadableStream({ cancel() { discarded++; } }), { status: 503, headers: { "retry-after": "0" } }) : new Response("complete");
  };
  assert.equal(await (await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, fetcher)).text(), "complete");
  assert.equal(calls, 3); assert.equal(discarded, 2);
  calls = 0;
  const post = await maintenanceFetch("https://fixture.invalid", { method: "POST", body: "payload" }, undefined, undefined, fetcher);
  assert.equal(post.status, 503); await post.body?.cancel();
  assert.equal(calls, 1);
  calls = 0;
  const permanent: typeof fetch = async () => { calls++; return new Response("unauthorized", { status: 401 }); };
  const unauthorized = await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, permanent);
  assert.equal(unauthorized.status, 401); assert.equal(calls, 1); await unauthorized.body?.cancel();
  calls = 0;
  const unavailable: typeof fetch = async () => { calls++; return new Response("busy", { status: 429, headers: { "retry-after": "0" } }); };
  const busy = await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, unavailable);
  assert.equal(busy.status, 429); assert.equal(calls, 3); await busy.body?.cancel();
});
test("Retry-After is respected within total budget and cancellation interrupts backoff", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response("busy", { status: 503, headers: { "retry-after": "3600" } }); };
  const busy = await maintenanceFetch("https://fixture.invalid", {}, undefined, { ...defaultMaintenanceBudgets, totalMs: 1000 }, fetcher);
  assert.equal(busy.status, 503); assert.equal(calls, 1); await busy.body?.cancel();
  const controller = new AbortController(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const pending = maintenanceFetch("https://fixture.invalid", { signal: controller.signal }, undefined, { ...defaultMaintenanceBudgets, totalMs: 5000 }, async () => { started(); return new Response("busy", { status: 503, headers: { "retry-after": "1" } }); });
  await ready; controller.abort(new MaintenanceError("cancelled", "fixture cancelled")); await assert.rejects(pending, { code: "cancelled" });
});
test("network failure before headers retries but consumed streams never restart silently", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { if (++calls < 3) throw new TypeError("fetch failed"); return new Response("complete"); };
  assert.equal(await (await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, fetcher)).text(), "complete"); assert.equal(calls, 3);
  calls = 0; let pulls = 0;
  const broken: typeof fetch = async () => { calls++; return new Response(new ReadableStream({ pull(stream) { if (!pulls++) stream.enqueue(new Uint8Array([65])); else stream.error(new TypeError("interrupted")); } })); };
  const response = await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, broken);
  await assert.rejects(response.text(), /interrupted/); assert.equal(calls, 1);
  const truncated = await maintenanceFetch("https://fixture.invalid", {}, undefined, undefined, async () => new Response("short", { headers: { "content-length": "20" } }));
  await assert.rejects(truncated.text(), { code: "network" });
});
