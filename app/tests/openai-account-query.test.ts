import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenAIAccountCheck, queryOpenAIUsage } from "../src/server/providers/openai-usage.js";
import { publicUsage } from "../src/server/provider-usage-cache.js";

const credential = { type: "oauth" as const, access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", expires: Date.now() + 3600000, accountId: "personal" };
const expires = "2098-06-01T00:00:00Z";
const entry = (id: string, plan = "pro", date: unknown = expires) => ({ account: { account_id: id, plan_type: plan }, entitlement: { expires_at: date }, private: "PRIVATE_RAW" });
const signal = () => new AbortController().signal;

test("account check matches identity, not paid/default workspace, and never mixes plans or raw fields", () => {
  const raw = { accounts: { default: entry("workspace", "team"), personal: entry("personal") } };
  assert.deepEqual(parseOpenAIAccountCheck(raw, "personal", "pro"), { accountId: "personal", plan: "pro", subscriptionExpiresAt: Date.parse(expires) });
  assert.equal(parseOpenAIAccountCheck(raw), undefined, "multiple identities without a routing proof are ambiguous");
  assert.equal(parseOpenAIAccountCheck(raw, "missing"), undefined);
  assert.equal(parseOpenAIAccountCheck(raw, "workspace", "pro"), undefined);
  assert.equal(parseOpenAIAccountCheck({ accounts: { default: { account: { plan_type: "pro" } } } }), undefined, "default alias is not an account identity");
  assert.equal(parseOpenAIAccountCheck({ accounts: { personal: { ...entry("personal"), disabled: true } } }, "personal"), undefined);
  assert.deepEqual(parseOpenAIAccountCheck({ accounts: { default: entry("personal"), personal: entry("personal") } }),
    { accountId: "personal", plan: "pro", subscriptionExpiresAt: Date.parse(expires) }, "duplicate aliases represent one account");
  for (const date of ["bad", "2026", 1900000000, Infinity, ""]) {
    assert.deepEqual(parseOpenAIAccountCheck({ accounts: { personal: entry("personal", "pro", date) } }, "personal"), { accountId: "personal", plan: "pro" });
  }
});

test("read-only account/entitlement success enriches identity while quota failure remains explicit", async () => {
  const calls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(new Headers(init.headers).get("chatgpt-account-id"), "personal");
    return url.includes("/accounts/check/") ? new Response(JSON.stringify({ accounts: { personal: entry("personal") } })) : new Response("PRIVATE_DENIED", { status: 403 });
  }) as typeof fetch;
  const result = await queryOpenAIUsage("openai-codex", credential, signal(), fetcher);
  assert.equal(result.status, "unavailable"); assert.match(result.message!, /HTTP 403/);
  assert.equal(calls.length, 2); assert.ok(result.updatedAt);
  assert.ok(calls[0].includes("/accounts/check/")); assert.ok(calls[1].endsWith("/usage"));
  assert.deepEqual(result.account, { accountId: "personal", plan: "pro", subscriptionExpiresAt: Date.parse(expires) });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
});

test("subscriptions fallback uses the matched account and best-effort failure cannot erase successful quota", async () => {
  for (const mode of ["success", "denied", "wrong-account", "wrong-plan", "bad-date"] as const) {
    const calls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push(url); assert.equal(init.method, "GET");
      if (url.endsWith("/usage")) return new Response(JSON.stringify({ plan_type: "pro", email: "live@example.test", credits: { balance: "12.3400" } }));
      if (url.endsWith("/rate-limit-reset-credits")) return new Response(JSON.stringify({ available_count: 2 }));
      if (url.includes("/accounts/check/")) return new Response(JSON.stringify({ accounts: { workspace: entry("workspace", "team"), personal: entry("personal", "pro", null) } }));
      assert.equal(url, "https://chatgpt.com/backend-api/subscriptions?account_id=personal");
      assert.equal(new Headers(init.headers).get("chatgpt-account-id"), "personal");
      return mode === "denied" ? new Response("PRIVATE_BODY", { status: 401 }) : new Response(JSON.stringify({
        account_id: mode === "wrong-account" ? "workspace" : "personal", plan_type: mode === "wrong-plan" ? "team" : "pro",
        active_until: mode === "bad-date" ? "2026" : expires, id: "PRIVATE_SUBSCRIPTION_ID", will_renew: true,
      }));
    }) as typeof fetch;
    const result = await queryOpenAIUsage("openai-codex", credential, signal(), fetcher);
    assert.equal(result.status, "ready"); assert.equal(calls.length, 4);
    assert.equal(result.metrics.find(m => m.kind === "balance")?.balance, "12.3400");
    assert.equal(result.account?.subscriptionExpiresAt, mode === "success" ? Date.parse(expires) : undefined);
    assert.equal(result.account?.plan, "pro");
    if (mode === "denied") assert.match(result.message!, /HTTP 401/);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("an unclassified direct token queries without local account ID and can use a unique returned identity", async () => {
  const urls: string[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    urls.push(url);
    if (url.includes("/accounts/check/")) assert.equal(new Headers(init.headers).has("chatgpt-account-id"), false);
    else assert.equal(new Headers(init.headers).get("chatgpt-account-id"), "personal", "the preflight-proven identity routes all follow-up reads");
    return new Response(JSON.stringify(url.includes("/accounts/check/") ? { accounts: { default: entry("personal") } }
      : url.endsWith("/usage") ? { plan_type: "pro", credits: { balance: "1" } } : { available_count: 0 }));
  }) as typeof fetch;
  const result = await queryOpenAIUsage("openai", { ...credential, accountId: undefined, scopes: ["chatgpt.tokens.use.direct"] }, signal(), fetcher);
  assert.equal(urls.length, 3); assert.equal(result.status, "ready"); assert.notEqual(result.refreshable, false);
  assert.equal(result.account?.accountId, "personal"); assert.equal(result.account?.subscriptionExpiresAt, Date.parse(expires));
});

test("mismatched quota account never leaks another account's quota, while matched profile stays independent", async () => {
  const fetcher = (async (url: string) => new Response(JSON.stringify(url.includes("/accounts/check/") ? { accounts: { personal: entry("personal") } }
    : url.endsWith("/usage") ? { account_id: "workspace", plan_type: "team", credits: { balance: "999" } } : { available_count: 99 }))) as typeof fetch;
  const result = await queryOpenAIUsage("openai", credential, signal(), fetcher);
  assert.equal(result.status, "unavailable"); assert.match(result.message!, /账号.*不一致/);
  assert.deepEqual(result.metrics, []); assert.equal(result.accountStatus?.state, "unknown");
  assert.equal(result.account?.accountId, "personal"); assert.equal(result.account?.plan, "pro");
});

test("public cache projection preserves bounded account identity and subscription date only", () => {
  const value = { providerId: "openai", status: "ready", metrics: [], account: {
    email: "live@example.test", plan: "pro", accountId: "account:fixture.1", subscriptionExpiresAt: Date.parse(expires),
    access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", id_token: "PRIVATE_JWT", raw: "PRIVATE_RAW", expiresAt: 123,
  } };
  assert.deepEqual(publicUsage(value, "openai")?.account, { email: "live@example.test", plan: "pro", accountId: "account:fixture.1", subscriptionExpiresAt: Date.parse(expires) });
  assert.doesNotMatch(JSON.stringify(publicUsage(value, "openai")), /PRIVATE|expiresAt/);
  assert.deepEqual(publicUsage({ ...value, account: { accountId: "bad\nID", subscriptionExpiresAt: 9e15 } }, "openai")?.account, undefined);
});
