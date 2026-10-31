import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodeBuddyOAuth } from "../src/native-providers/codebuddy/auth.js";
import type { NativeAuthInteraction, NativeOAuthCredential } from "../src/native-providers/contracts.js";

const credential: NativeOAuthCredential = { type: "oauth", access: "ACCESS", refresh: "REFRESH", expires: 1 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const signal = () => new AbortController().signal;
const interaction = (): NativeAuthInteraction => ({ signal: signal(), notify() {}, async prompt() { throw new Error("unexpected prompt"); } });
const secretFree = (error: unknown) => error instanceof Error && !error.message.includes("SECRET");

test("independent CodeBuddy OAuth retains exact CN protocol and new CLI profile", async () => {
  let calls = 0;
  const oauth = createCodeBuddyOAuth({ pollIntervalMs: 1, fetch: async (input, init) => {
    calls++;
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    assert.equal(url.origin, "https://copilot.tencent.com");
    assert.equal(headers.get("user-agent"), "CLI/2.179.0 CodeBuddy/2.179.0");
    assert.equal(init?.redirect, "error");
    if (calls === 1) {
      assert.equal(url.pathname, "/v2/plugin/auth/state");
      assert.equal(init?.body, "{}");
      assert.equal(headers.get("x-no-authorization"), "true");
      return json({ code: 0, data: { state: "fixture +/?", authUrl: "https://copilot.tencent.com/authorize" } });
    }
    if (calls <= 3) {
      assert.equal(url.pathname, "/v2/plugin/auth/token");
      assert.equal(url.searchParams.get("state"), "fixture +/?");
      assert.equal(init?.method, "GET");
      return calls === 2 ? json({ code: 11217 }, 400) : json({ code: 0, data: { accessToken: "ACCESS", refreshToken: "REFRESH", expiresIn: 3600 } });
    }
    assert.equal(url.pathname, "/v2/plugin/auth/token/refresh");
    assert.equal(headers.get("authorization"), "Bearer ACCESS");
    assert.equal(headers.get("x-refresh-token"), "REFRESH");
    return json({ code: 0, data: { accessToken: "NEXT", expiresIn: 3600 } });
  } });
  const loggedIn = await oauth.login(interaction());
  const rotated = await oauth.refresh(loggedIn, signal());
  assert.equal(rotated.access, "NEXT"); assert.equal(rotated.refresh, "REFRESH"); assert.equal(calls, 4);
});

test("independent OAuth sanitizes transport and body failures without retry", async () => {
  for (const kind of ["fetch", "body", "json", "size", "http"] as const) {
    let calls = 0;
    const oauth = createCodeBuddyOAuth({ fetch: async () => {
      calls++;
      if (kind === "fetch") throw new Error("SECRET token in URL");
      if (kind === "body") return new Response(new ReadableStream({ start(c) { c.error(new Error("SECRET")); } }));
      if (kind === "json") return new Response("SECRET");
      if (kind === "size") return new Response("x".repeat(1024 * 1024 + 1));
      return json({ secret: "SECRET" }, 401);
    } });
    await assert.rejects(oauth.refresh(credential, signal()), secretFree);
    assert.equal(calls, 1);
  }
});

test("independent OAuth bounds uncooperative acquisition and closes a late response", async () => {
  let resolve!: (value: Response) => void, canceled = 0;
  const oauth = createCodeBuddyOAuth({ requestTimeoutMs: 10, fetch: () => new Promise<Response>(done => { resolve = done; }) });
  await assert.rejects(oauth.refresh(credential, signal()), /超时/);
  resolve(new Response(new ReadableStream({ cancel() { canceled++; } })));
  await new Promise(done => setImmediate(done));
  assert.equal(canceled, 1);
});

test("independent OAuth aborts a noncooperative body and never returns late tokens", async () => {
  const controller = new AbortController();
  let canceled = 0;
  const oauth = createCodeBuddyOAuth({ fetch: async () => new Response(new ReadableStream({
    start() { setTimeout(() => controller.abort(), 5); }, cancel() { canceled++; },
  })) });
  await assert.rejects(oauth.refresh(credential, controller.signal), { name: "AbortError" });
  assert.equal(canceled, 1);
});

test("independent OAuth rejects credential injection before IO and validates returned tokens", async () => {
  let calls = 0;
  const oauth = createCodeBuddyOAuth({ fetch: async () => { calls++; return json({ code: 0, data: { accessToken: "SECRET\r\n", refreshToken: "REFRESH" } }); } });
  for (const field of ["access", "refresh"] as const) {
    await assert.rejects(oauth.refresh({ ...credential, [field]: "SECRET\r\n" }, signal()), secretFree);
  }
  assert.equal(calls, 0);
  await assert.rejects(oauth.refresh(credential, signal()), secretFree);
  assert.equal(calls, 1);
  for (const requestTimeoutMs of [0, -1, Infinity, 1.5]) assert.throws(() => createCodeBuddyOAuth({ requestTimeoutMs }));
});
