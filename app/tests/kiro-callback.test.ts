import assert from "node:assert/strict";
import { test } from "node:test";
import { get } from "node:http";
import { kiroCallback } from "../src/server/providers/kiro-callback.js";
import type { ProviderAuthInteraction } from "@earendil-works/pi-ai";

const interaction = (signal: AbortSignal): ProviderAuthInteraction => ({ signal, notify: () => {}, prompt: prompt => new Promise((_resolve, reject) => {
  const abort = () => reject(new DOMException("Cancelled", "AbortError"));
  if (prompt.signal?.aborted) abort(); else prompt.signal?.addEventListener("abort", abort, { once: true });
}) });
const request = (url: string, host?: string) => new Promise<{ status: number; body: string }>((resolve, reject) => {
  get(url, { headers: host ? { Host: host } : {} }, response => {
    let body = ""; response.setEncoding("utf8").on("data", chunk => { body += chunk; });
    response.on("end", () => resolve({ status: response.statusCode!, body }));
  }).on("error", reject);
});

test("Kiro loopback rejects foreign state, duplicate params and Host without consuming login", async () => {
  const signal = new AbortController().signal;
  const callback = await kiroCallback("EXPECTED", signal, { ports: [0] });
  const waiting = callback.wait(interaction(signal));
  const base = `${callback.origin}/oauth/callback?code=PRIVATE-SECRET&login_option=google`;
  try {
    for (const [suffix, host] of [["&state=wrong", undefined], ["&state=EXPECTED&code=duplicate", undefined], ["&state=EXPECTED", "evil.test"]]) {
      const response = await request(base + suffix, host);
      assert.equal(response.status, 400); assert.ok(!response.body.includes("PRIVATE-SECRET"));
    }
    const response = await request(base + "&state=EXPECTED");
    assert.equal(response.status, 200); assert.ok(!response.body.includes("PRIVATE-SECRET"));
    assert.deepEqual(await waiting, { code: "PRIVATE-SECRET", redirectUri: `${callback.origin}/oauth/callback?login_option=google` });
    assert.equal((await request(base + "&state=EXPECTED")).status, 400);
  } finally { await callback.close(); }
  await assert.rejects(request(base), /ECONNREFUSED/);
});

test("Kiro validated denial and wrong login branch terminate immediately with redacted errors", async () => {
  for (const query of ["error=access_denied&error_description=PRIVATE-SECRET", "code=PRIVATE-SECRET&login_option=awsidc"]) {
    const signal = new AbortController().signal;
    const callback = await kiroCallback("EXPECTED", signal, { ports: [0] });
    const waiting = callback.wait(interaction(signal));
    const rejected = assert.rejects(waiting, (error: Error) => !error.message.includes("PRIVATE-SECRET"));
    try {
      assert.equal((await request(`${callback.origin}/oauth/callback?state=EXPECTED&${query}`)).status, 400);
      await rejected;
    } finally { await callback.close(); }
  }
});

test("Kiro callback cancellation closes the socket and OIDC accepts manual exact redirect", async () => {
  const controller = new AbortController();
  const callback = await kiroCallback("STATE", controller.signal, { ports: [0] });
  const waiting = assert.rejects(callback.wait(interaction(controller.signal)), { name: "AbortError" });
  controller.abort(); await waiting; await callback.close();
  await assert.rejects(request(`${callback.origin}/oauth/callback`), /ECONNREFUSED/);
  const signal = new AbortController().signal;
  const oidc = await kiroCallback("OIDC-STATE", signal, { oidc: true });
  try {
    const value = await oidc.wait({ signal, notify: () => {}, prompt: async () => `${oidc.origin}/oauth/callback?state=OIDC-STATE&code=CODE` });
    assert.deepEqual(value, { code: "CODE", redirectUri: `${oidc.origin}/oauth/callback` });
  } finally { await oidc.close(); }
});
