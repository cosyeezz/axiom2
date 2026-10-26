import assert from "node:assert/strict";
import { test } from "node:test";
import { createModels, InMemoryCredentialStore, type AuthEvent, type OAuthCredential } from "@earendil-works/pi-ai";
import { codeBuddyOAuth } from "../src/server/providers/codebuddy-auth.js";
import { codeBuddyProvider } from "../src/server/providers/codebuddy-cn.js";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const start = { code: 0, data: { state: "state +/?", authUrl: "https://copilot.tencent.com/authorize?state=fixture" } };
const credential: OAuthCredential = { type: "oauth", access: "OLD-ACCESS", refresh: "OLD-REFRESH", expires: 1 };
const interaction = (signal = new AbortController().signal, events: AuthEvent[] = []) => ({
  signal, notify: (event: AuthEvent) => { events.push(event); }, prompt: async () => { throw new Error("unexpected prompt"); },
});

test("CodeBuddy browser login polls GET with encoded state and preserves token expiry", async () => {
  const events: AuthEvent[] = [];
  let calls = 0;
  const oauth = codeBuddyOAuth({ pollIntervalMs: 1, fetch: async (input, init) => {
    const url = new URL(String(input)), headers = new Headers(init?.headers);
    assert.equal(url.origin, "https://copilot.tencent.com");
    assert.equal(headers.get("x-product"), "SaaS");
    assert.equal(headers.get("x-no-authorization"), "true");
    assert.equal(headers.get("x-no-enterprise-id"), "true");
    assert.equal(headers.get("x-no-department-info"), "true");
    assert.equal(headers.get("user-agent"), "CLI/2.173.0 CodeBuddy/2.173.0");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (calls++ === 0) {
      assert.equal(url.pathname, "/v2/plugin/auth/state");
      assert.equal(url.searchParams.get("platform"), "CLI");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, "{}");
      return json(start);
    }
    assert.equal(init?.method, "GET");
    assert.equal(url.pathname, "/v2/plugin/auth/token");
    assert.equal(url.searchParams.get("state"), "state +/?");
    assert.equal(headers.get("x-no-department-info"), "true");
    return json(calls === 2 ? { code: 11217 } : { code: 0, data: { accessToken: "ACCESS", refreshToken: "REFRESH", expiresIn: 3600 } });
  } });
  const before = Date.now();
  const result = await oauth.login(interaction(undefined, events));
  assert.equal(calls, 3);
  assert.equal(events[0].type, "auth_url");
  assert.deepEqual({ ...result, expires: 0 }, { type: "oauth", access: "ACCESS", refresh: "REFRESH", expires: 0 });
  assert.ok(result.expires >= before + 3600000 && result.expires <= Date.now() + 3600000);
});

test("CodeBuddy login cancels pending fetch, polling delay, and late successful responses", async () => {
  for (const phase of ["fetch", "delay", "late"] as const) {
    const controller = new AbortController();
    let calls = 0;
    const oauth = codeBuddyOAuth({ pollIntervalMs: phase === "delay" ? 10000 : 1, fetch: async (_input, init) => {
      calls++;
      if (phase === "fetch") {
        controller.abort();
        assert.equal(init?.signal?.aborted, true);
        init?.signal?.throwIfAborted();
      }
      if (calls === 1) return json(start);
      controller.abort(); // A transport may still finish after the user cancels.
      return json({ code: 0, data: { accessToken: "LATE", refreshToken: "LATE" } });
    } });
    const pending = oauth.login({ ...interaction(controller.signal), notify: () => { if (phase === "delay") controller.abort(); } });
    await assert.rejects(pending, { name: "AbortError" });
    assert.equal(calls, phase === "late" ? 2 : 1);
  }
});

test("CodeBuddy login times out, fails unknown business codes, and does not expose response secrets", async () => {
  const timeout = codeBuddyOAuth({ pollIntervalMs: 2, loginTimeoutMs: 15, fetch: async (input) => json(String(input).includes("/state?") ? start : { code: 11217 }) });
  await assert.rejects(timeout.login(interaction()), /登录超时/);
  for (const body of [{ code: 12345, msg: "PRIVATE-SECRET" }, { code: 0, data: { accessToken: "PRIVATE-SECRET" } }, { code: 0, data: { accessToken: "PRIVATE-SECRET", refreshToken: "PRIVATE-SECRET", expiresIn: -1 } }]) {
    let calls = 0;
    const oauth = codeBuddyOAuth({ pollIntervalMs: 1, fetch: async () => json(calls++ === 0 ? start : body) });
    await assert.rejects(oauth.login(interaction()), (error: Error) => !error.message.includes("PRIVATE-SECRET"));
    assert.equal(calls, 2, "only explicit pending responses are retried");
  }
  const invalidUrl = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { state: "fixture", authUrl: "javascript:alert(1)" } }) });
  await assert.rejects(invalidUrl.login(interaction()), /HTTPS/);
  const httpError = codeBuddyOAuth({ fetch: async () => json({ secret: "PRIVATE-SECRET" }, 401) });
  await assert.rejects(httpError.login(interaction()), (error: Error) => /401/.test(error.message) && !error.message.includes("PRIVATE-SECRET"));
});

test("CodeBuddy refresh uses header token, rotates credentials under pi lock, and retains old refresh when omitted", async () => {
  let requests = 0;
  const oauth = codeBuddyOAuth({ fetch: async (input, init) => {
    requests++;
    assert.equal(String(input), "https://copilot.tencent.com/v2/plugin/auth/token/refresh");
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, "{}");
    assert.equal(new Headers(init?.headers).get("x-refresh-token"), "OLD-REFRESH");
    assert.equal(new Headers(init?.headers).get("x-auth-refresh-source"), "plugin");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer OLD-ACCESS");
    return json({ code: 0, data: { accessToken: "NEW-ACCESS", refreshToken: "NEW-REFRESH", expiresIn: 3600 } });
  } });
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("codebuddy-cn", async () => credential);
  const models = createModels({ credentials });
  const provider = codeBuddyProvider();
  models.setProvider({ ...provider, auth: { ...provider.auth, oauth } });
  const auth = await Promise.all(Array.from({ length: 8 }, () => models.getAuth("codebuddy-cn")));
  assert.equal(requests, 1);
  assert.ok(auth.every(value => value?.auth.apiKey === "NEW-ACCESS"));
  assert.equal((await credentials.read("codebuddy-cn") as OAuthCredential).refresh, "NEW-REFRESH");
  const withoutRefresh = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { accessToken: "NEW" } }) });
  assert.equal((await withoutRefresh.refresh(credential, new AbortController().signal)).refresh, "OLD-REFRESH");
});

test("CodeBuddy poll accepts pending codes in HTTP error envelopes without retrying unrelated errors", async () => {
  let calls = 0;
  const oauth = codeBuddyOAuth({ pollIntervalMs: 1, fetch: async () => {
    calls++;
    if (calls === 1) return json(start);
    if (calls === 2) return json({ code: 11217, msg: "PRIVATE-SECRET" }, 400);
    return json({ code: 0, data: { accessToken: "ACCESS", refreshToken: "REFRESH", expiresIn: 3600 } });
  } });
  assert.equal((await oauth.login(interaction())).access, "ACCESS");
  assert.equal(calls, 3);
  for (const code of [401, 11218]) {
    let requests = 0;
    const rejected = codeBuddyOAuth({ pollIntervalMs: 1, fetch: async () => ++requests === 1
      ? json(start) : json({ code, msg: "PRIVATE-SECRET" }, 401) });
    await assert.rejects(rejected.login(interaction()), (error: Error) => /HTTP 401/.test(error.message) && !error.message.includes("PRIVATE-SECRET"));
    assert.equal(requests, 2);
  }
});

test("CodeBuddy expiry prefers official absolute milliseconds and bounds its local missing-expiry policy", async () => {
  const expiresAt = Date.now() + 30 * 60_000;
  const absolute = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { accessToken: "NEW", expiresAt, expiresIn: 86400 } }) });
  assert.equal((await absolute.refresh(credential, new AbortController().signal)).expires, expiresAt);
  for (const empty of [null, 0, ""]) {
    const before = Date.now();
    const relative = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { accessToken: "NEW", expiresAt: empty, expiresIn: 1800 } }) });
    const result = await relative.refresh(credential, new AbortController().signal);
    assert.ok(result.expires >= before + 1800_000 && result.expires <= Date.now() + 1800_000);
  }
  const before = Date.now();
  const missing = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { accessToken: "NEW" } }) });
  const refreshed = await missing.refresh(credential, new AbortController().signal);
  assert.ok(refreshed.expires >= before + 3600_000 && refreshed.expires <= Date.now() + 3600_000);
  for (const invalid of [-1, "invalid", Date.now() - 1, Number.MAX_SAFE_INTEGER + 1]) {
    const bad = codeBuddyOAuth({ fetch: async () => json({ code: 0, data: { accessToken: "PRIVATE-SECRET", expiresAt: invalid, expiresIn: 3600 } }) });
    await assert.rejects(bad.refresh(credential, new AbortController().signal), /有效期无效/);
  }
});

test("CodeBuddy failed refresh preserves the stored credential", async () => {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("codebuddy-cn", async () => credential);
  const models = createModels({ credentials });
  models.setProvider({ ...codeBuddyProvider(), auth: { oauth: codeBuddyOAuth({ fetch: async () => json({ code: 1, msg: "SECRET" }) }) } });
  await assert.rejects(models.getAuth("codebuddy-cn"), /OAuth refresh failed/);
  assert.deepEqual(await credentials.read("codebuddy-cn"), credential);
});
