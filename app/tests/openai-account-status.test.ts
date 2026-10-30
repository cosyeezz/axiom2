import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOpenAIAccountCheck, queryOpenAIUsage } from "../src/server/providers/openai-usage.js";
import { ProviderUsageService } from "../src/server/provider-usage.js";
import { publicUsage } from "../src/server/provider-usage-cache.js";
import { quotaSamplePeriod } from "../src/shared/quota-estimate.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";

const credential = { type: "oauth" as const, access: "PRIVATE_ACCESS", refresh: "PRIVATE_REFRESH", expires: Date.now() + 86400000, accountId: "personal" };
const entry = (id = "personal") => ({ account: { account_id: id, plan_type: "pro" }, entitlement: { expires_at: "2098-06-01T00:00:00Z" } });
const profile = () => ({ accounts: { personal: entry() } });
const signal = () => new AbortController().signal;
const quota = { account_id: "personal", credits: { balance: "15" } };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

test("status GET completes before quota, which completes before reset-credit and subscription reads", async () => {
  const calls: string[] = [];
  let releaseProfile!: (value: Response) => void, releaseQuota!: (value: Response) => void;
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    if (url.includes("/accounts/check/")) return new Promise<Response>(resolve => { releaseProfile = resolve; });
    assert.equal(new Headers(init.headers).get("chatgpt-account-id"), "personal");
    if (url.endsWith("/usage")) return new Promise<Response>(resolve => { releaseQuota = resolve; });
    return json({ available_count: 0 });
  }) as typeof fetch;
  const pending = queryOpenAIUsage("openai", credential, signal(), fetcher);
  assert.equal(calls.length, 1); releaseProfile(json(profile()));
  while (!releaseQuota) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2); releaseQuota(json(quota));
  const result = await pending;
  assert.equal(result.status, "ready"); assert.equal(result.accountStatus?.state, "active");
  assert.equal(calls.length, 3); assert.ok(calls[2].endsWith("/rate-limit-reset-credits"));
});

test("disabled targets never fall back to another healthy workspace, and entitlement expiry is not a ban", async () => {
  for (const marker of [{ disabled: true }, { is_deactivated: true }, { deactivated_at: "2090-01-01" }, { state: " suspended " }, { status: "inactive" }]) {
    for (const nested of [false, true]) {
      const target = entry();
      const raw = { accounts: { default: entry("workspace"), personal: nested ? { ...target, account: { ...target.account, ...marker } } : { ...target, ...marker } } };
      assert.equal(inspectOpenAIAccountCheck(raw, "personal").state, "disabled");
      let calls = 0;
      const result = await queryOpenAIUsage("openai", credential, signal(), (async () => { calls++; return json(raw); }) as typeof fetch);
      assert.equal(calls, 1); assert.equal(result.accountStatus?.state, "disabled"); assert.deepEqual(result.metrics, []);
      assert.match(result.message!, /停止后续/);
    }
  }
  const expired = { accounts: { personal: { ...entry(), entitlement: { expires_at: "2000-01-01T00:00:00Z" } } } };
  assert.equal(inspectOpenAIAccountCheck(expired, "personal").state, "active");
});

test("missing identity, ambiguous accounts, incomplete status and contradictory aliases remain unknown", async () => {
  const cases = [ {}, { accounts: {} }, { accounts: { workspace: entry("workspace") } },
    { accounts: { personal: { account: { account_id: "personal" } } } },
    { accounts: { personal: { ...entry(), status: "pending" } } },
    { accounts: { personal: entry(), default: { ...entry(), disabled: true } } },
    { accounts: { personal: entry(), default: { ...entry(), entitlement: { expires_at: "2099-01-01T00:00:00Z" } } } },
  ];
  for (const raw of cases) {
    let calls = 0;
    const result = await queryOpenAIUsage("openai", credential, signal(), (async () => { calls++; return json(raw); }) as typeof fetch);
    assert.equal(calls, 1); assert.equal(result.accountStatus?.state, "unknown"); assert.deepEqual(result.metrics, []);
  }
  assert.equal(inspectOpenAIAccountCheck({ accounts: { personal: entry(), workspace: entry("workspace") } }).state, "unknown");
  assert.equal(inspectOpenAIAccountCheck({ accounts: { personal: entry(), default: entry() } }).state, "active");
  assert.equal(inspectOpenAIAccountCheck({ accounts: { personal: { account: { account_id: "personal", status: "active" } } } }).state, "active");
});

test("only bounded structured codes prove disabled/revoked, not free-form messages or HTTP status", async () => {
  for (const code of ["account_disabled", "deactivated_workspace", "organization_deactivated", "org_suspended", "token_revoked", "token_invalidated"]) {
    for (const status of [200, 401, 403]) {
      for (const body of [{ error: { code, message: "PRIVATE_BODY" } }, { response: { error: { code } } }, { detail: { code } }, { code }]) {
        let calls = 0;
        const result = await queryOpenAIUsage("openai", credential, signal(), (async () => { calls++; return json(body, status); }) as typeof fetch);
        assert.equal(calls, 1); assert.equal(result.accountStatus?.state, code.startsWith("token_") ? "unauthorized" : "disabled");
        assert.deepEqual(result.metrics, []); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
      }
    }
  }
  for (const status of [401, 403, 429, 503]) {
    let calls = 0;
    const result = await queryOpenAIUsage("openai", credential, signal(), (async () => { calls++; return json({ error: { message: "account_disabled token_revoked PRIVATE_BODY" } }, status); }) as typeof fetch);
    assert.equal(calls, 1); assert.equal(result.accountStatus?.state, "unknown"); assert.match(result.message!, new RegExp(`HTTP ${status}`));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|明确标记/);
  }
  const challenged = await queryOpenAIUsage("openai", credential, signal(), (async () => new Response("<html>PRIVATE cloudflare</html>", { status: 403, headers: { "cf-mitigated": "challenge" } })) as typeof fetch);
  assert.equal(challenged.accountStatus?.state, "unknown"); assert.match(challenged.message!, /质询/);
});

test("explicit abnormal state at any subsequent read stops the chain and discards successful quota", async () => {
  for (const stage of ["/usage", "/rate-limit-reset-credits", "/subscriptions?"]) {
    const calls: string[] = [];
    const fetcher = (async (url: string) => {
      calls.push(url);
      if (url.includes(stage)) return json({ error: { code: "account_disabled" } }, 403);
      if (url.includes("/accounts/check/")) return json({ accounts: { personal: { ...entry(), entitlement: {} } } });
      return json(url.endsWith("/usage") ? quota : { available_count: 1 });
    }) as typeof fetch;
    const result = await queryOpenAIUsage("openai", credential, signal(), fetcher);
    assert.equal(result.accountStatus?.state, "disabled"); assert.deepEqual(result.metrics, []);
    assert.equal(calls.length, stage === "/usage" ? 2 : stage === "/rate-limit-reset-credits" ? 3 : 4);
  }
});

test("aborting at each completed GET cannot launch a follow-up query", async () => {
  for (const abortAt of [1, 2, 3, 4]) {
    const controller = new AbortController(); let calls = 0;
    await assert.rejects(queryOpenAIUsage("openai", credential, controller.signal, (async (url: string) => {
      if (++calls === abortAt) controller.abort();
      return json(url.includes("/accounts/check/") ? { accounts: { personal: { ...entry(), entitlement: {} } } }
        : url.endsWith("/usage") ? quota : url.includes("/subscriptions?") ? { account_id: "personal" } : { available_count: 0 });
    }) as typeof fetch), { name: "AbortError" });
    assert.equal(calls, abortAt);
  }
});

test("supplied malformed identities are not treated as omitted optional routing fields", async () => {
  for (const id of [null, "", "bad ID", "bad\nID", 7, {}]) {
    const raw = { accounts: { personal: { account: { account_id: id, plan_type: "pro" } } } };
    assert.equal(inspectOpenAIAccountCheck(raw, "personal").state, "unknown");
    let calls = 0;
    const result = await queryOpenAIUsage("openai", credential, signal(), (async (url: string) => {
      calls++; return json(url.includes("/accounts/check/") ? profile() : { ...quota, account_id: id });
    }) as typeof fetch);
    assert.equal(calls, 2); assert.equal(result.accountStatus?.state, "unknown"); assert.deepEqual(result.metrics, []);
    const subscription = await queryOpenAIUsage("openai", credential, signal(), (async (url: string) => json(url.includes("/accounts/check/")
      ? { accounts: { personal: { ...entry(), entitlement: {} } } } : url.endsWith("/usage") ? quota
      : url.includes("/subscriptions?") ? { account_id: id, active_until: "2098-06-01T00:00:00Z" } : { available_count: 0 })) as typeof fetch);
    assert.equal(subscription.account?.subscriptionExpiresAt, undefined);
  }
});

test("new disabled or unknown status cannot revive a ready cache, survive as a quota shortcut, or lose status on disk", async t => {
  for (const state of ["disabled", "unknown", "unauthorized"] as const) {
    const root = mkdtempSync(join(tmpdir(), "axiom-status-cache-")), dir = join(root, "pi"); mkdirSync(dir);
    t.after(() => rmSync(root, { recursive: true, force: true }));
    writeFileSync(join(dir, "auth.json"), JSON.stringify({ openai: credential }));
    let now = Date.now(), calls = 0;
    t.mock.method(Date, "now", () => now);
    let result: ProviderUsage = { providerId: "openai", status: "ready", accountStatus: { state: "active", checkedAt: now }, updatedAt: now,
      metrics: [{ id: "credits", kind: "balance", label: "点数", balance: "15" }] };
    const query = async () => { calls++; return result; }, service = new ProviderUsageService(root, dir, query);
    await service.read("openai"); assert.ok(service.peekCached("openai"));
    const existingViewer = new ProviderUsageService(root, dir, query); await existingViewer.read("openai");
    assert.ok(existingViewer.peekCached("openai"));
    now += 5000; result = { providerId: "openai", status: "unavailable", accountStatus: { state, checkedAt: now }, metrics: [], message: "停止后续查询" };
    const blocked = await service.read("openai", true);
    assert.equal(blocked.status, "unavailable"); assert.deepEqual(blocked.metrics, []); assert.equal(blocked.stale, undefined);
    assert.equal(service.peekCached("openai"), undefined);
    assert.equal(existingViewer.peekCached("openai"), undefined, "existing in-memory active snapshot cannot hide another viewer's newer rejection");
    assert.deepEqual(await existingViewer.read("openai"), blocked);
    const restored = new ProviderUsageService(root, dir, query);
    assert.deepEqual(await restored.read("openai"), blocked); assert.equal(restored.peekCached("openai"), undefined); assert.equal(calls, 2);
    t.mock.restoreAll();
  }
});

test("status projection strips private fields, rejects malformed states and prevents anomalous estimates", () => {
  const now = Date.now(), usage = { providerId: "openai", status: "ready", metrics: [{ id: "credits", kind: "balance", label: "点数", balance: "15" }],
    accountStatus: { state: "disabled", checkedAt: now, payload: "PRIVATE_RAW" }, stale: true };
  const projected = publicUsage(usage, "openai")!;
  assert.deepEqual(projected.accountStatus, { state: "disabled", checkedAt: now }); assert.equal(projected.status, "unavailable");
  assert.deepEqual(projected.metrics, []); assert.equal(projected.stale, undefined); assert.doesNotMatch(JSON.stringify(projected), /PRIVATE/);
  assert.equal(publicUsage({ ...usage, accountStatus: { state: "banned", checkedAt: now } }, "openai"), undefined);
  assert.equal(publicUsage({ ...usage, accountStatus: { state: "active", checkedAt: -1 } }, "openai"), undefined);
  assert.equal(quotaSamplePeriod({ ...projected, status: "ready", updatedAt: now }, { id: "primary_window", kind: "window", label: "5小时", usedPercent: 50, windowSeconds: 18000, resetsAt: now + 1000 }), undefined);
});
