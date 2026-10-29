import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createModels, InMemoryCredentialStore, type AuthEvent, type ProviderAuthInteraction } from "@earendil-works/pi-ai";
import { kiroOAuth, type KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroProvider } from "../src/server/providers/kiro.js";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const registered = () => ({ clientId: "CLIENT", clientSecret: "CLIENT-SECRET", clientSecretExpiresAt: Math.floor(Date.now() / 1000) + 86400 });
const device = { deviceCode: "DEVICE", userCode: "USER-CODE", verificationUri: "https://device.sso.us-east-1.amazonaws.com/", verificationUriComplete: "https://device.sso.us-east-1.amazonaws.com/?user_code=USER-CODE", interval: 2, expiresIn: 600 };
const granted = { accessToken: "ACCESS", refreshToken: "REFRESH", expiresIn: 3600, profileArn: "arn:aws:codewhisperer:us-east-1:123:profile/real" };
const interaction = (answers: string[], events: AuthEvent[] = [], signal = new AbortController().signal): ProviderAuthInteraction => ({
  signal, notify: event => { events.push(event); }, prompt: async prompt => { prompt.signal?.throwIfAborted(); assert.ok(answers.length, `Unexpected ${prompt.type} prompt`); return answers.shift()!; },
});
const saved = (method: KiroCredential["authMethod"] = "identity-center"): KiroCredential => ({
  type: "oauth", authMethod: method, authRegion: "us-east-1", startUrl: "https://org.awsapps.com/start", access: "OLD", refresh: "OLD-REFRESH", expires: 1,
  clientId: "CLIENT", clientSecret: "CLIENT-SECRET", clientSecretExpiresAt: Date.now() + 86400_000, profileArn: "REAL-ARN",
});

test("Kiro distinguishes personal Builder ID from enterprise OIDC and honors slow_down", async () => {
  for (const method of ["builder-id", "identity-center"] as const) {
    const calls: { url: URL; body: any }[] = [], waits: number[] = [], events: AuthEvent[] = [];
    const answers = method === "builder-id" ? [method, "device"] : [method, "https://org.awsapps.com/start", "eu-west-1", "device"];
    const oauth = kiroOAuth({ wait: async ms => { waits.push(ms); }, fetch: async (input, init) => {
      assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      const url = new URL(String(input)), body = JSON.parse(String(init?.body)); calls.push({ url, body });
      assert.equal(url.hostname, `oidc.${method === "builder-id" ? "us-east-1" : "eu-west-1"}.amazonaws.com`);
      if (calls.length === 1) return json(registered());
      if (calls.length === 2) return json(device);
      if (calls.length === 3) return json({ error: "authorization_pending", error_description: "PRIVATE-SECRET" }, 400);
      if (calls.length === 4) return json({ error: "slow_down" }, 400);
      if (calls.length === 5) return json({ __type: "com.amazon#SlowDownException" }, 400);
      return json(granted);
    } });
    const result = await oauth.login(interaction(answers, events));
    assert.equal(result.authMethod, method); assert.equal(result.access, "ACCESS");
    assert.equal(Number(result.clientSecretExpiresAt) > Date.now(), true);
    assert.equal(result.profileArn, granted.profileArn);
    assert.deepEqual(waits, [2000, 2000, 7000, 12000]);
    assert.equal(calls[0].url.pathname, "/client/register");
    assert.deepEqual(calls[0].body, {
      clientName: "OAuth Client", clientType: "public",
      scopes: ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"],
      grantTypes: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      issuerUrl: method === "builder-id" ? "https://view.awsapps.com/start" : "https://org.awsapps.com/start",
    }, `${method} device registration must omit redirectUris and entitledApplicationArn`);
    assert.deepEqual(Object.keys(calls[0].body), ["clientName", "clientType", "grantTypes", "issuerUrl", "scopes"]);
    assert.equal(calls[2].body.deviceCode, "DEVICE");
    assert.equal(calls[1].url.pathname, "/device_authorization");
    assert.deepEqual(events[0], { type: "device_code", userCode: "USER-CODE", verificationUri: device.verificationUriComplete, intervalSeconds: 2, expiresInSeconds: 600 });
  }
});

test("Kiro OIDC browser PKCE registers exact bodies for both identities and exchanges camelCase fields", async () => {
  for (const method of ["builder-id", "identity-center"] as const) {
    const authRegion = method === "builder-id" ? "us-east-1" : "eu-west-1";
    const issuerUrl = method === "builder-id" ? "https://view.awsapps.com/start" : "https://org.awsapps.com/start";
    const origin = `https://oidc.${authRegion}.amazonaws.com`, redirectUri = "http://127.0.0.1:44991/oauth/callback";
    const events: AuthEvent[] = []; let closed = false, registration: any, callbackState = "", registrations = 0, exchanges = 0;
    const oauth = kiroOAuth({ callback: async (state, _signal, options) => {
      assert.equal(options?.oidc, true); callbackState = state;
      return { origin: "http://127.0.0.1:44991", wait: async () => ({ code: "CODE", redirectUri }), close: async () => { closed = true; } };
    }, fetch: async (input, init) => {
      assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      const url = new URL(String(input)), body = JSON.parse(String(init?.body));
      assert.equal(url.origin, origin);
      if (url.pathname === "/client/register") {
        registrations++; registration = body;
        assert.deepEqual(body, {
          clientName: "OAuth Client", clientType: "public",
          scopes: ["codewhisperer:completions", "codewhisperer:analysis", "codewhisperer:conversations"],
          grantTypes: ["authorization_code", "refresh_token"], issuerUrl, redirectUris: [redirectUri],
        }, `${method} PKCE registration must include the exact redirect and omit entitledApplicationArn`);
        assert.deepEqual(Object.keys(body), ["clientName", "clientType", "grantTypes", "issuerUrl", "redirectUris", "scopes"]);
        return json(registered());
      }
      assert.equal(url.pathname, "/token"); exchanges++;
      const event = events[0]; assert.equal(event.type, "auth_url"); if (event.type !== "auth_url") throw Error();
      const authorize = new URL(event.url);
      assert.equal(authorize.origin, origin); assert.equal(authorize.pathname, "/authorize");
      assert.equal(authorize.searchParams.get("state"), callbackState);
      assert.equal(authorize.searchParams.has("scope"), false); assert.equal(authorize.searchParams.get("scopes"), registration.scopes.join(" "));
      assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorize.searchParams.get("code_challenge"), createHash("sha256").update(body.codeVerifier).digest("base64url"));
      assert.equal(authorize.searchParams.get("redirect_uri"), redirectUri);
      assert.equal(body.code, "CODE"); assert.equal(body.grantType, "authorization_code");
      assert.equal(body.redirectUri, registration.redirectUris[0]); assert.equal(body.clientSecret, "CLIENT-SECRET");
      return json(granted);
    } });
    const answers = method === "builder-id" ? [method, "pkce"] : [method, issuerUrl, authRegion, "pkce"];
    const result = await oauth.login(interaction(answers, events));
    assert.equal(result.authMethod, method); assert.equal(result.authRegion, authRegion); assert.equal(result.startUrl, issuerUrl);
    assert.ok(closed); assert.equal(registrations, 1); assert.equal(exchanges, 1);
  }
});

test("Kiro social portal PKCE uses CLI redirect marker, snake_case exchange, and distinct refresh", async () => {
  const events: AuthEvent[] = []; let state = "", closed = false;
  const oauth = kiroOAuth({ callback: async value => {
    state = value;
    return { origin: "http://127.0.0.1:44992", wait: async () => ({ code: "SOCIAL-CODE", redirectUri: "http://127.0.0.1:44992/oauth/callback?login_option=google" }), close: async () => { closed = true; } };
  }, fetch: async (url, init) => {
    assert.equal(String(url), "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token");
    const body = JSON.parse(String(init?.body));
    const event = events[0]; assert.equal(event.type, "auth_url"); if (event.type !== "auth_url") throw Error();
    const login = new URL(event.url); assert.equal(login.origin, "https://app.kiro.dev");
    assert.equal(login.searchParams.get("redirect_from"), "kirocli"); assert.equal(login.searchParams.get("state"), state);
    assert.equal(login.searchParams.get("code_challenge"), createHash("sha256").update(body.code_verifier).digest("base64url"));
    assert.equal(body.code, "SOCIAL-CODE"); assert.match(body.redirect_uri, /login_option=google$/);
    return json({ ...granted, expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  } });
  const credential = await oauth.login(interaction(["social"], events));
  assert.ok(closed); assert.equal(credential.authMethod, "social"); assert.equal(credential.clientSecret, undefined);
  const refresh = kiroOAuth({ fetch: async (url, init) => {
    assert.equal(String(url), "https://prod.us-east-1.auth.desktop.kiro.dev/refreshToken");
    assert.deepEqual(JSON.parse(String(init?.body)), { refreshToken: "REFRESH" });
    return json({ accessToken: "NEW", expiresIn: 3600 });
  } });
  const renewed = await refresh.refresh(credential, new AbortController().signal);
  assert.equal(renewed.refresh, "REFRESH"); assert.equal(renewed.profileArn, granted.profileArn);
});

test("Kiro OIDC refresh retains region/registration and rotates under the SDK credential lock", async () => {
  let count = 0;
  const oauth = kiroOAuth({ fetch: async (url, init) => {
    count++; assert.equal(String(url), "https://oidc.us-east-1.amazonaws.com/token");
    assert.deepEqual(JSON.parse(String(init?.body)), { clientId: "CLIENT", clientSecret: "CLIENT-SECRET", refreshToken: "OLD-REFRESH", grantType: "refresh_token" });
    return json(granted);
  } });
  const credentials = new InMemoryCredentialStore(); await credentials.modify("kiro", async () => saved());
  const models = createModels({ credentials }); models.setProvider({ ...kiroProvider(), auth: { oauth } });
  const result = await Promise.allSettled(Array.from({ length: 6 }, () => models.getAuth("kiro")));
  assert.equal(count, 1);
  assert.ok(result.every(r => r.status === "rejected" && /仅供原生适配器/.test(r.reason.cause?.message)), "refresh works, but OAuth tokens are never derived for inference");
  const stored = await credentials.read("kiro") as KiroCredential;
  assert.equal(stored.authMethod, "identity-center"); assert.equal(stored.clientSecret, "CLIENT-SECRET"); assert.equal(stored.refresh, "REFRESH");
});

test("Kiro rejects expired registration and malformed/unknown metadata without network", async () => {
  const oauth = kiroOAuth({ fetch: async () => { throw Error("SHOULD-NOT-REQUEST"); } });
  for (const patch of [{ clientSecretExpiresAt: Date.now() - 1 }, { authRegion: "us-east-1.evil.test" }, { authMethod: "external_idp" }, { authMethod: "social", authRegion: "eu-west-1" }, { startUrl: "http://org.test/start" }]) {
    await assert.rejects(oauth.refresh({ ...saved(), ...patch }, new AbortController().signal), error => !(error as Error).message.includes("SHOULD-NOT-REQUEST"));
  }
});

test("Kiro errors do not expose secrets and failed refresh preserves credentials", async () => {
  for (const response of [json({ error: "invalid_grant", error_description: "PRIVATE-SECRET" }, 400), new Response("PRIVATE-SECRET", { status: 502 }), json({ accessToken: "PRIVATE-SECRET", expiresIn: -1 })]) {
    const credentials = new InMemoryCredentialStore(); const previous = saved(); await credentials.modify("kiro", async () => previous);
    const models = createModels({ credentials }); models.setProvider({ ...kiroProvider(), auth: { oauth: kiroOAuth({ fetch: async () => response }) } });
    await assert.rejects(models.getAuth("kiro"), error => !(error as Error).message.includes("PRIVATE-SECRET"));
    assert.deepEqual(await credentials.read("kiro"), previous);
  }
  const oauth = kiroOAuth({ fetch: async () => { throw Error("PRIVATE-SECRET"); } });
  await assert.rejects(oauth.refresh(saved(), new AbortController().signal), error => !(error as Error).message.includes("PRIVATE-SECRET"));
});

test("Kiro device cancellation and timeout reject late tokens and stop polling", async () => {
  for (const phase of ["wait", "late"] as const) {
    const controller = new AbortController(); let count = 0;
    const oauth = kiroOAuth({ wait: async () => { if (phase === "wait") controller.abort(); }, fetch: async () => {
      count++;
      if (count === 1) return json(registered()); if (count === 2) return json(device);
      controller.abort(); return json(granted);
    } });
    await assert.rejects(oauth.login(interaction(["builder-id", "device"], [], controller.signal)), { name: "AbortError" });
    assert.equal(count, phase === "wait" ? 2 : 3);
  }
  let count = 0;
  const timeout = kiroOAuth({ loginTimeoutMs: 15, fetch: async () => json(++count === 1 ? registered() : device) });
  await assert.rejects(timeout.login(interaction(["builder-id", "device"])), /超时/);
  assert.equal(count, 2);
});
