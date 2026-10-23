import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { QoderCredentials, packQoderCredential, qoderExpiry, qoderOAuth } from "../src/server/providers/qoder-auth.js";
import { decodeQoderBody, encodeQoderBody, qoderHeaders, qoderInference, qoderJson, qoderSites, type QoderRegion } from "../src/server/providers/qoder-protocol.js";

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
test("Qoder regional PKCE login handles pending responses, validates expiry and never fakes refresh", async () => {
  for (const region of ["cn", "intl"] as const) {
    let url: URL | undefined, polls = 0;
    const oauth = qoderOAuth(region, { pollIntervalMs: 1, fetch: async (input, init) => {
      const poll = new URL(String(input));
      assert.equal(poll.origin, qoderSites[region].open);
      assert.equal(poll.pathname, "/api/v1/deviceToken/poll");
      assert.equal(poll.searchParams.get("nonce"), url!.searchParams.get("nonce"));
      assert.equal(createHash("sha256").update(poll.searchParams.get("verifier")!).digest("base64url"), url!.searchParams.get("challenge"));
      assert.equal(init?.redirect, "error");
      if (++polls < 3) return new Response(null, { status: polls === 1 ? 202 : 404 });
      return json({ token: "dt-FIXTURE", user_id: "user-fixture", expires_at: new Date(Date.now() + 3600000).toISOString() });
    } });
    const result = await oauth.login({ signal: new AbortController().signal, prompt: async () => "", notify: event => { if (event.type === "auth_url") url = new URL(event.url); } });
    assert.equal(url!.origin, new URL(qoderSites[region].login).origin);
    assert.equal(result.region, region); assert.equal(result.machineId, url!.searchParams.get("machine_id"));
    assert.equal(result.refresh, "");
    assert.equal(JSON.parse(packQoderCredential(result, region)).token, "dt-FIXTURE");
    assert.throws(() => packQoderCredential(result, region === "cn" ? "intl" : "cn"), /地区/);
    await assert.rejects(oauth.refresh(result, new AbortController().signal), /重新登录/);
  }
});
test("Qoder cancellation, timeout, invalid JSON and auth failures do not leak credentials", async () => {
  const controller = new AbortController(); controller.abort();
  const interaction = { signal: controller.signal, prompt: async () => "", notify: () => {} };
  await assert.rejects(qoderOAuth("cn", { fetch: async () => { throw Error("must not fetch"); } }).login(interaction), { name: "AbortError" });
  await assert.rejects(qoderOAuth("cn", { pollIntervalMs: 20, loginTimeoutMs: 1 }).login({ ...interaction, signal: new AbortController().signal }), /超时/);
  for (const response of [new Response("SECRET", { status: 403 }), json({ token: "dt-SECRET", user_id: "x" }), new Response("SECRET")]) {
    await assert.rejects(qoderOAuth("cn", { pollIntervalMs: 1, fetch: async () => response }).login({ ...interaction, signal: new AbortController().signal }), error => error instanceof Error && !error.message.includes("SECRET"));
  }
  for (const value of [{}, { expires_at: 1 }, { expires_in: -1 }, { expires_at: "bad" }]) assert.throws(() => qoderExpiry(value, "seconds"), /期限/);
  assert.ok(qoderExpiry({ expires_in: 3000 }, "milliseconds") - Date.now() <= 3000);
  for (const expires_in of [3600, 3600000]) assert.ok(Math.abs(qoderExpiry({ expires_in }, "pat") - Date.now() - 3600000) < 100);
  assert.ok(qoderExpiry({ expires_at: Math.floor(Date.now() / 1000) + 3600 }, "pat") > Date.now());
});
test("Qoder PAT exchange is region-isolated, short-lived and cached; raw device keys rejected", async () => {
  for (const region of ["cn", "intl"] as QoderRegion[]) {
    let calls = 0;
    const store = new QoderCredentials(region), signal = new AbortController().signal;
    const transport: typeof fetch = async (input, init) => {
      calls++; const url = new URL(String(input)); assert.equal(url.origin, qoderSites[region].open);
      assert.equal(init?.redirect, "error");
      if (url.pathname.endsWith("exchange")) { const body = JSON.parse(String(init?.body)); assert.equal(body.personal_token, "pt-SECRET"); assert.equal(body.machine_token, body.machine_id); assert.ok(body.machine_id); return json({ token: "jt-SECRET", expires_at: new Date(Date.now() + 3600000).toISOString() }); }
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer jt-SECRET"); return json({ id: "user-fixture" });
    };
    const first = await store.resolve("pt-SECRET", transport, signal), next = await store.resolve("pt-SECRET", transport, signal);
    assert.equal(calls, 2); assert.deepEqual(first, next);
    await assert.rejects(store.resolve("dt-SECRET", transport), /仅支持/);
    await assert.rejects(store.resolve("pt-bad", async () => json({ token: "jt-invalid", expires_at: 1 })), /期限/);
  }
});
test("Qoder device refresh preserves region and machine identity, requires a complete response", async () => {
  for (const region of ["cn", "intl"] as const) {
    const credential = { type: "oauth" as const, access: "dt-old", refresh: "refresh-fixture", expires: Date.now(), region, userId: "user-fixture", machineId: "machine-fixture" };
    const oauth = qoderOAuth(region, { fetch: async (input, init) => {
      assert.equal(String(input), `${qoderSites[region].open}/api/v1/deviceToken/refresh`);
      assert.equal(init?.redirect, "error");
      assert.deepEqual(JSON.parse(String(init?.body)), { refresh_token: credential.refresh, machine_id: credential.machineId, machine_token: credential.machineId });
      return json({ device_token: "dt-new", refresh_token: "refresh-new", expires_at: new Date(Date.now() + 3600000).toISOString() });
    } });
    const result = await oauth.refresh(credential, new AbortController().signal);
    assert.equal(result.access, "dt-new"); assert.equal(result.refresh, "refresh-new"); assert.equal(result.machineId, credential.machineId); assert.equal(result.region, region);
    await assert.rejects(qoderOAuth(region, { fetch: async () => json({ device_token: "dt-SECRET" }) }).refresh(credential, new AbortController().signal), /重新登录/);
  }
});
test("Qoder JSON response limit cancels before buffering an unbounded body", async () => {
  let reads = 0, cancelled = false;
  const response = new Response(new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }));
  await assert.rejects(qoderJson(async () => response, "https://fixture.invalid", {}), /安全限制/);
  assert.ok(reads <= 6); assert.equal(cancelled, true);
  await assert.rejects(qoderJson(async () => { throw Error("Qoder SECRET-token"); }, "https://fixture.invalid", {}), error => error instanceof Error && !error.message.includes("SECRET"));
});
test("Qoder decoding is strict and election never carries credentials across region boundaries", async () => {
  for (const bad of ["abc", "中文", "!!!!$", "$$$$", "abc "]) assert.throws(() => decodeQoderBody(bad));
  const payload = { chat: [{ key: "auto" }] };
  for (const text of [JSON.stringify(payload), encodeQoderBody(JSON.stringify(payload))]) {
    assert.deepEqual(await qoderJson(async () => new Response(text), "https://fixture.invalid", {}, true), payload);
  }
  const identity = { token: "jt-FIXTURE", userId: "user", machineId: "machine" };
  for (const region of ["cn", "intl"] as const) {
    const origin = region === "cn" ? "https://gateway.qoder.com.cn" : "https://api3.qoder.sh";
    assert.equal(await qoderInference(region, identity, async (input, init) => {
      assert.equal(String(input), `${qoderSites[region].center}/algo/api/v5/service/region/endpoints`);
      assert.equal(init?.redirect, "error"); assert.equal(new Headers(init?.headers).get("authorization"), "Bearer jt-FIXTURE");
      return new Response(encodeQoderBody(JSON.stringify({ inferNodes: [{ url: origin, type: "public" }] })));
    }), origin);
    const blocked = ["http://api2.qoder.sh", "https://evil.invalid", "https://api2.qoder.sh:444", "https://user@api2.qoder.sh", "https://api2.qoder.sh/path", region === "cn" ? "https://api2.qoder.sh" : "https://gateway.qoder.com.cn"];
    for (const url of blocked) await assert.rejects(qoderInference(region, identity, async () => json({ inferNodes: [url] })), /端点/);
    let calls = 0;
    await assert.rejects(qoderInference(region, identity, async () => { calls++; return new Response("SECRET", { status: 403 }); }), /权限/);
    assert.equal(calls, 1, "unverified anonymous V3 fallback must not run");
  }
});
test("Qoder encoding and COSY signatures cover exact UTF8 wire bytes without exposing the token", () => {
  assert.equal(encodeQoderBody(""), "");
  const identity = { userId: "fixture-user", token: "dt-SECRET", machineId: "fixture-machine" };
  for (const plain of ["hello", '{"text":"中文🙂"}']) {
    const body = encodeQoderBody(plain);
    assert.equal(decodeQoderBody(body), plain);
    const headers = qoderHeaders(body, "https://gateway.qoder.com.cn/algo/api/v2/test?Encode=1", identity);
    const [, payload, signature] = headers.Authorization.split(".");
    assert.equal(signature, createHash("md5").update(`${payload}\n${headers["Cosy-Key"]}\n${headers["Cosy-Date"]}\n${body}\n/api/v2/test`).digest("hex"));
    assert.equal(headers["Cosy-Bodylength"], String(Buffer.byteLength(body)));
    assert.equal(headers["Cosy-Bodyhash"], createHash("md5").update(body).digest("hex"));
    assert.equal(JSON.stringify(headers).includes("dt-SECRET"), false);
    assert.notEqual(qoderHeaders(body, "https://gateway.qoder.com.cn/algo/api/v2/test", identity).Authorization, headers.Authorization);
  }
});
