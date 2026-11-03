import assert from "node:assert/strict";
import { test } from "node:test";
import type { OAuthCredential } from "@earendil-works/pi-ai";
import { parseQoderPlan, parseQoderQuota, queryQoderUsage } from "../src/server/providers/qoder-quota.js";
import { encodeQoderBody, qoderClientHeaders, qoderSites } from "../src/server/providers/qoder-protocol.js";
import { publicUsage } from "../src/server/provider-usage-cache.js";
import { supportsProviderUsage } from "../src/server/provider-usage.js";
import { usageMetricValue } from "../src/shared/provider-usage.js";

const signal = () => AbortSignal.timeout(5000);
const credential = (region = "cn"): OAuthCredential => ({ type: "oauth", access: "dt-PRIVATE", refresh: "PRIVATE-R", expires: Date.now() + 3600_000, userId: "u-PRIVATE", machineId: "m-PRIVATE", region });
const quota = {
  user_id: "u-PRIVATE", user_type: "personal_pro", totalUsagePercentage: 0.4, upgradeUrl: "https://evil.invalid",
  userQuota: { total: 2000, used: 812.5, remaining: 1187.5, percentage: 0.41, unit: "credits" },
  addOnQuota: { total: 500, used: 0, detailUrl: "https://evil.invalid" },
  orgResourcePackage: { used: 30, cap: 1000, remaining: 70 },
  dedicatedResourcePackages: [
    { id: "p1", name: "Claude Pack", total: 100, used: 40, remaining: 60, unit: "credits", expiresAt: 1_900_000_000_000, status: "QUOTA_DETAIL_STATUS_ACTIVE" },
    { id: "p2", name: "Old", total: 100, used: 100, status: "QUOTA_DETAIL_STATUS_EXPIRED" },
    { id: "p3", name: "<script>", total: 10, used: 1 },
  ],
};
const plan = { user_type: "personal_pro", plan_tier_name: "Pro", end_date: 1_900_000_000_000, organization: { org_id: "PRIVATE-ORG" } };

test("Qoder quota: read-only Bearer GETs include CLI sender headers, encoded bodies accepted", async () => {
  assert.ok(supportsProviderUsage("qoder") && supportsProviderUsage("qoder-cn"));
  const calls: { url: string; init?: RequestInit }[] = [];
  const usage = await queryQoderUsage("qoder-cn", credential(), signal(), async (url, init) => {
    calls.push({ url: String(url), init });
    const body = String(url).endsWith("/quota/usage") ? quota : plan;
    return new Response(String(url).endsWith("/quota/usage") ? encodeQoderBody(JSON.stringify(body)) : JSON.stringify(body));
  });
  assert.deepEqual(calls.map(call => call.url).sort(), [`${qoderSites.cn.open}/api/v2/quota/usage`, `${qoderSites.cn.open}/api/v2/user/plan`]);
  for (const { init } of calls) {
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.equal(init?.body, undefined);
    assert.deepEqual(Object.keys(init?.headers as object).sort(), ["Accept", "Authorization", "Cosy-ClientType", "Cosy-MachineOS", "Cosy-Version", "X-Request-ID"]);
    const headers = init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer dt-PRIVATE");
    for (const [key, value] of Object.entries(qoderClientHeaders())) assert.equal(headers[key], value);
    assert.match(headers["X-Request-ID"], /^[A-F\d]{8}-[A-F\d]{4}-4[A-F\d]{3}-[89AB][A-F\d]{3}-[A-F\d]{12}$/);
  }
  assert.notEqual(new Headers(calls[0].init?.headers).get("x-request-id"), new Headers(calls[1].init?.headers).get("x-request-id"));
  assert.equal(usage.status, "ready"); assert.equal(usage.accountStatus?.state, "active");
  assert.deepEqual(usage.account, { plan: "Pro", subscriptionExpiresAt: 1_900_000_000_000 });
  assert.deepEqual(usage.metrics.map(metric => [metric.id, metric.label, usageMetricValue(metric)]), [
    ["user", "套餐额度", "812.5 / 2,000 credits"], ["add-on", "附加额度", "0 / 500 credits"], ["org", "组织资源包", "30 / 100 credits"],
    ["dedicated:0", "Claude Pack", "40 / 100 credits"], ["dedicated:2", "专属资源包", "1 / 10 credits"]]);
  assert.equal((usage.metrics[3] as { expiresAt?: number }).expiresAt, 1_900_000_000_000);
  assert.ok(!JSON.stringify(usage).includes("PRIVATE") && !JSON.stringify(usage).includes("evil"));
  assert.deepEqual(publicUsage(JSON.parse(JSON.stringify(usage)), "qoder-cn"), usage);
});

test("Qoder quota: region mismatch sends nothing; plan failure keeps quota; 401 stops", async () => {
  let calls = 0;
  const mismatch = await queryQoderUsage("qoder", credential("cn"), signal(), async () => { calls++; return Response.json(quota); });
  assert.equal(calls, 0); assert.equal(mismatch.status, "unavailable"); assert.equal(mismatch.accountStatus?.state, "unknown");
  const partial = await queryQoderUsage("qoder-cn", credential(), signal(), async url => String(url).endsWith("/plan") ? new Response("PRIVATE", { status: 500 }) : Response.json(quota));
  assert.equal(partial.status, "ready"); assert.equal(partial.account, undefined); assert.equal(partial.metrics.length, 5);
  const unauthorized = await queryQoderUsage("qoder-cn", credential(), signal(), async url => String(url).endsWith("/plan") ? new Response("PRIVATE", { status: 401 }) : Response.json(quota));
  assert.equal(unauthorized.accountStatus?.state, "unauthorized"); assert.equal(unauthorized.metrics.length, 0);
  for (const [status, text] of [[403, /403/], [429, /限流/], [502, /HTTP 502/]] as const) {
    const failed = await queryQoderUsage("qoder-cn", credential(), signal(), async () => new Response("PRIVATE", { status }));
    assert.equal(failed.accountStatus?.state, "unknown"); assert.match(failed.message!, text); assert.ok(!failed.message!.includes("PRIVATE"));
  }
  const network = await queryQoderUsage("qoder-cn", credential(), signal(), async () => { throw new Error("PRIVATE"); });
  assert.match(network.message!, /无法连接/);
});

test("Qoder parsers require CLI identity fields and tolerate seconds", () => {
  for (const input of [{ userQuota: { total: 1 } }, { userId: "", userType: "pro" }, { userId: "u" }]) assert.throws(() => parseQoderQuota(input));
  assert.deepEqual(parseQoderQuota({ userId: "u", userType: "free" }), []);
  assert.deepEqual(parseQoderPlan({ userType: "free", planName: "Free", endDate: 1_900_000_000 }), { plan: "Free", subscriptionExpiresAt: 1_900_000_000_000 });
  assert.deepEqual(parseQoderPlan({ user_type: "pro", plan_tier_name: "x".repeat(80), end_date: 0 }), {});
  assert.deepEqual(parseQoderPlan({ planName: "Pro", endDate: 1_900_000_000_000 }), {});
});

test("Qoder quota aliases project only valid amounts, anonymous package IDs never escape", () => {
  const metrics = parseQoderQuota({ userId: "PRIVATE", userType: "pro", user_quota: { total: "100.5", used: "0.25", unit: "<script>" },
    shared_quota: { used: 20, remaining: 30, cap: 1000 }, add_on_quota: { total: -1, used: Infinity },
    dedicated_resource_packages: [{ name: "missing id", total: 1 }, { id: "PRIVATE1", name: "no amounts" },
      { id: "PRIVATE2", total: 10, used: 10, status: "QUOTA_DETAIL_STATUS_EXHAUSTED", expires_at: "1900000000000" }] });
  assert.deepEqual(metrics[0], { id: "user", kind: "quota", label: "套餐额度", used: 0.25, limit: 100.5, unit: "credits" });
  assert.deepEqual(metrics[1], { id: "add-on", kind: "quota", label: "附加额度", used: null, limit: null, unit: "credits" });
  assert.equal((metrics[2] as { limit: number }).limit, 50);
  assert.equal(metrics.length, 4); assert.equal((metrics[3] as { expiresAt: number }).expiresAt, 1900000000000);
  assert.ok(!JSON.stringify(metrics).includes("PRIVATE"));
});

test("Qoder intl stays in region; canceled calls and invalid responses never retry or refresh", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++; assert.equal(new URL(String(url)).origin, qoderSites.intl.open);
    assert.equal(init?.method, "GET"); return Response.json(String(url).endsWith("/plan") ? plan : quota);
  };
  const ready = await queryQoderUsage("qoder", credential("intl"), signal(), transport);
  assert.equal(ready.status, "ready"); assert.equal(calls, 2);
  const canceled = new AbortController(); canceled.abort();
  await assert.rejects(queryQoderUsage("qoder", credential("intl"), canceled.signal, transport), { name: "AbortError" });
  assert.equal(calls, 2);
  const malformed = await queryQoderUsage("qoder", credential("intl"), signal(), async () => new Response("PRIVATE not JSON"));
  assert.equal(malformed.accountStatus?.state, "unknown"); assert.ok(!JSON.stringify(malformed).includes("PRIVATE"));
  const rejected = await queryQoderUsage("qoder", credential("intl"), signal(), async url => new Response("PRIVATE", { status: String(url).endsWith("/plan") ? 500 : 401 }));
  assert.equal(rejected.accountStatus?.state, "unauthorized"); assert.deepEqual(rejected.metrics, []);
});
