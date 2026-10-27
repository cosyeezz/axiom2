import assert from "node:assert/strict";
import { test } from "node:test";
import { get } from "node:http";
import { setImmediate as nextTick } from "node:timers/promises";
import type { AuthEvent, ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { kiroOAuth, type KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroCallback } from "../src/server/providers/kiro-callback.js";

const saved = (): KiroCredential => ({ type: "oauth", authMethod: "social", authRegion: "us-east-1", access: "FIXTURE-OLD", refresh: "FIXTURE-REFRESH", expires: 1 });
const noSecret = (error: unknown) => error instanceof Error && !error.message.includes("PRIVATE-SECRET");
// AbortSignal.timeout uses unref timers; the deliberately stalled fixtures need
// a live handle so node:test can observe expiry rather than cancel the test.
async function held<T>(run: () => Promise<T>) {
  const timer = setInterval(() => {}, 100);
  try { return await run(); } finally { clearInterval(timer); }
}

test("Kiro auth caps declared and streamed body bytes and redacts invalid JSON/UTF-8", async () => {
  for (const response of [
    new Response("PRIVATE-SECRET", { headers: { "Content-Length": String(2 * 1024 * 1024 + 1) } }),
    new Response("PRIVATE-SECRET".padEnd(2 * 1024 * 1024 + 1, "x")),
    new Response("PRIVATE-SECRET"),
    new Response(Uint8Array.from([123, 34, 255, 34, 58, 49, 125])),
  ]) {
    const oauth = kiroOAuth({ fetch: async () => response });
    await assert.rejects(oauth.refresh(saved(), new AbortController().signal), noSecret);
  }
});

test("Kiro auth deadline bounds an uncooperative body and does not await stuck cancel", { timeout: 1500 }, async () => held(async () => {
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    pull: () => new Promise<void>(() => {}),
    cancel: () => { cancelled++; return new Promise<void>(() => {}); },
  }));
  const oauth = kiroOAuth({ requestTimeoutMs: 20, fetch: async () => response });
  const start = Date.now();
  await assert.rejects(oauth.refresh(saved(), new AbortController().signal), { name: "TimeoutError" });
  assert.equal(cancelled, 1);
  assert.ok(Date.now() - start < 1000);
}));

test("Kiro auth deadline rejects ignored fetch signals and cancels a late body", { timeout: 1500 }, async () => held(async () => {
  let finish!: (response: Response) => void;
  let cancelled = 0;
  const oauth = kiroOAuth({ requestTimeoutMs: 20, fetch: () => new Promise<Response>(resolve => { finish = resolve; }) });
  await assert.rejects(oauth.refresh(saved(), new AbortController().signal), /网络请求失败或超时/);
  finish(new Response(new ReadableStream({ cancel: () => { cancelled++; } })));
  await nextTick();
  assert.equal(cancelled, 1);
}));

test("Kiro auth cancellation stops a pending body without waiting for its transport", { timeout: 1500 }, async () => held(async () => {
  const controller = new AbortController();
  let cancelled = 0;
  const response = new Response(new ReadableStream({
    pull: () => { controller.abort(); return new Promise<void>(() => {}); },
    cancel: () => { cancelled++; },
  }));
  const oauth = kiroOAuth({ fetch: async () => response });
  await assert.rejects(oauth.refresh(saved(), controller.signal), { name: "AbortError" });
  assert.equal(cancelled, 1);
}));

test("Kiro manual callback allows correcting format/state/origin/duplicates without leaking input", async () => {
  const signal = new AbortController().signal;
  const callback = await kiroCallback("EXPECTED", signal, { ports: [0] });
  const events: AuthEvent[] = [];
  const answers = [
    "PRIVATE-SECRET",
    `${callback.origin}/oauth/callback?state=wrong&code=PRIVATE-SECRET&login_option=google`,
    `http://example.invalid/oauth/callback?state=EXPECTED&code=PRIVATE-SECRET&login_option=google`,
    `${callback.origin}/oauth/callback?state=EXPECTED&code=PRIVATE-SECRET&code=duplicate&login_option=google`,
    `${callback.origin}/oauth/callback?state=EXPECTED&code=FIXTURE-CODE&login_option=google`,
  ];
  let prompts = 0;
  try {
    const value = await callback.wait({ signal, notify: event => { events.push(event); }, prompt: async () => { prompts++; assert.ok(answers.length); return answers.shift()!; } });
    assert.deepEqual(value, { code: "FIXTURE-CODE", redirectUri: `${callback.origin}/oauth/callback?login_option=google` });
    assert.equal(prompts, 5); assert.equal(events.length, 4);
    assert.ok(!JSON.stringify(events).includes("PRIVATE-SECRET"));
  } finally { await callback.close(); }
});

test("Kiro browser callback wins after invalid manual input and cancels the new prompt", async () => {
  const signal = new AbortController().signal;
  const callback = await kiroCallback("EXPECTED", signal, { ports: [0] });
  let prompts = 0, cancelled = 0, ready!: () => void;
  const prompted = new Promise<void>(resolve => { ready = resolve; });
  const interaction: ProviderAuthInteraction = { signal, notify: () => {}, prompt: async prompt => {
    if (++prompts === 1) return "PRIVATE-SECRET";
    return new Promise<string>((_resolve, reject) => {
      const abort = () => { cancelled++; reject(new DOMException("Cancelled", "AbortError")); };
      prompt.signal!.addEventListener("abort", abort, { once: true });
      ready();
    });
  } };
  try {
    const waiting = callback.wait(interaction);
    await prompted;
    await new Promise<void>((resolve, reject) => {
      get(`${callback.origin}/oauth/callback?state=EXPECTED&code=FIXTURE-CODE&login_option=github`, response => {
        assert.equal(response.statusCode, 200); response.resume(); response.on("end", resolve);
      }).on("error", reject);
    });
    assert.equal((await waiting).code, "FIXTURE-CODE");
    assert.equal(prompts, 2); assert.equal(cancelled, 1);
  } finally { await callback.close(); }
});

test("Kiro prompt rejection and validated terminal callbacks do not re-prompt", async () => {
  for (const answer of [undefined, "error=access_denied&error_description=PRIVATE-SECRET", "code=PRIVATE-SECRET&login_option=awsidc"]) {
    const signal = new AbortController().signal;
    const callback = await kiroCallback("EXPECTED", signal, { ports: [0] });
    let prompts = 0;
    try {
      await assert.rejects(callback.wait({ signal, notify: () => {}, prompt: async () => {
        prompts++;
        if (answer === undefined) throw new DOMException("Cancelled", "AbortError");
        return `${callback.origin}/oauth/callback?state=EXPECTED&${answer}`;
      } }), noSecret);
      assert.equal(prompts, 1);
    } finally { await callback.close(); }
  }
});
