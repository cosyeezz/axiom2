import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeContext, type Model } from "@earendil-works/pi-ai";
import { resolveKiroProfile } from "../src/server/providers/kiro-profile.js";
import { kiroChat } from "../src/server/providers/kiro-chat.js";
import { kiroOAuth, type KiroCredential } from "../src/server/providers/kiro-auth.js";
import { kiroFrame, kiroResponse } from "./fixtures/kiro-eventstream.js";
const arn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/test-profile";
const account = (patch: Partial<KiroCredential> = {}): KiroCredential => ({ type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3600000, authMethod: "identity-center", authRegion: "us-east-1", ...patch });
const signal = () => AbortSignal.timeout(5000);

test("enterprise discovery uses native AWS operation, not OIDC refresh or personal ARN", async () => {
  const original = account();
  const result = await resolveKiroProfile(original, signal(), async (url, init) => {
    assert.equal(url, "https://q.us-east-1.amazonaws.com/");
    assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
    const h = new Headers(init?.headers);
    assert.equal(h.get("authorization"), "Bearer PRIVATE-ACCESS");
    assert.equal(h.get("x-amz-target"), "AmazonCodeWhispererService.ListAvailableProfiles");
    assert.equal(h.get("tokentype"), null); assert.equal(h.get("user-agent"), null);
    assert.deepEqual(JSON.parse(String(init?.body)), { maxResults: 10 });
    assert.ok(!String(init?.body).includes("PRIVATE"));
    return Response.json({ profiles: [{ arn }] });
  });
  assert.equal(result.profileArn, arn); assert.equal(original.profileArn, undefined);
});

test("existing profile and non-enterprise credentials never trigger discovery", async () => {
  for (const credential of [account({ profileArn: arn }), account({ authMethod: "social" }), account({ authMethod: "builder-id" })]) {
    assert.equal(await resolveKiroProfile(credential, signal(), async () => { throw Error("unexpected"); }), credential);
  }
});

test("empty successful region can fall back, explicit enterprise region wins", async () => {
  const urls: string[] = [];
  const result = await resolveKiroProfile(account({ authRegion: "eu-west-1" }), signal(), async url => {
    urls.push(String(url)); return Response.json({ profiles: urls.length === 1 ? [] : [{ arn }] });
  });
  assert.equal(result.profileArn, arn);
  assert.deepEqual(urls, ["https://q.eu-central-1.amazonaws.com/", "https://q.us-east-1.amazonaws.com/"]);
});

test("pagination preserves one identity and rejects multiple profiles", async () => {
  let calls = 0;
  assert.equal((await resolveKiroProfile(account(), signal(), async (_url, init) => {
    calls++; assert.deepEqual(JSON.parse(String(init?.body)), calls === 1 ? { maxResults: 10 } : { maxResults: 10, nextToken: "next" });
    return Response.json(calls === 1 ? { profiles: [], nextToken: "next" } : { profiles: [{ arn }] });
  })).profileArn, arn);
  await assert.rejects(resolveKiroProfile(account(), signal(), async () => Response.json({ profiles: [{ arn }, { arn: arn + "2" }] })), /多个 profile/);
});

test("HTTP, empty, invalid and cyclic discovery fail closed without leaking body", async () => {
  for (const response of [new Response("PRIVATE-SERVER", { status: 403 }), Response.json({ profiles: [] }), Response.json({ profiles: [{ arn: "PRIVATE-BAD" }] }), Response.json({ profiles: [], nextToken: "repeat" }), new Response("bad-json"), new Response("x".repeat(17000))]) {
    let calls = 0;
    await assert.rejects(resolveKiroProfile(account(), signal(), async () => { calls++; return response.clone(); }), error => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /PRIVATE/); assert.match(error.message, /未发送推理请求/); return true;
    });
    assert.ok(calls <= 2);
  }
});

test("discovery checks abort before sending", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveKiroProfile(account(), controller.signal, async () => { throw Error("unexpected"); }), { name: "AbortError" });
});

test("native chat discovers before inference, routes by profile and caches only within credential", async () => {
  let discovery = 0, inference = 0;
  const provider = kiroChat(kiroOAuth(), async (url, init) => {
    if (new Headers(init?.headers).get("x-amz-target")?.endsWith("ListAvailableProfiles")) {
      discovery++; return Response.json({ profiles: [{ arn }] });
    }
    inference++; assert.equal(url, "https://runtime.eu-central-1.kiro.dev/");
    assert.equal(JSON.parse(String(init?.body)).profileArn, arn);
    return kiroResponse([kiroFrame("assistantResponseEvent", { content: "ok" })]);
  });
  const model: Model<"kiro-chat"> = { id: "selected", name: "Selected", provider: "kiro", api: "kiro-chat", baseUrl: "https://q.us-east-1.amazonaws.com", input: ["text"], reasoning: false, contextWindow: 100000, maxTokens: 8192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  for (const credential of [account(), account(), account({ access: "OTHER-ACCESS" })]) {
    const auth = await provider.auth.toAuth(credential);
    const result = await provider.stream(model, normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }), auth).result();
    assert.equal(result.stopReason, "stop");
  }
  assert.equal(discovery, 2); assert.equal(inference, 3);
});

test("failed discovery never sends inference", async () => {
  let calls = 0;
  const provider = kiroChat(kiroOAuth(), async () => { calls++; return new Response("PRIVATE", { status: 403 }); });
  const auth = await provider.auth.toAuth(account());
  const model = { id: "selected", provider: "kiro", api: "kiro-chat", input: ["text"] } as Model<"kiro-chat">;
  const result = await provider.stream(model, normalizeContext({ messages: [{ role: "user", content: "hello", timestamp: 1 }] }), auth).result();
  assert.equal(calls, 1); assert.equal(result.stopReason, "error"); assert.match(result.errorMessage!, /profile 查询失败/); assert.doesNotMatch(result.errorMessage!, /PRIVATE/);
});
