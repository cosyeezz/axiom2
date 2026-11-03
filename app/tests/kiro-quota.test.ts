import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchKiroQuota, parseKiroQuota, KiroQuotaError } from "../src/native-providers/kiro/quota.js";
import { queryKiroUsage } from "../src/server/providers/kiro-quota.js";
import { publicUsage } from "../src/server/provider-usage-cache.js";
import { supportsProviderUsage } from "../src/server/provider-usage.js";
import { hasQuotaRecord } from "../src/shared/session-account-usage.js";
import { usageMetricPercent } from "../src/shared/model-account-usage.js";
import { usageMetricValue } from "../src/shared/provider-usage.js";
import type { KiroCredential } from "../src/native-providers/kiro/auth.js";

const arn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/test-profile";
const credential = (patch: Partial<KiroCredential> = {}): KiroCredential => ({
  type: "oauth", access: "PRIVATE-ACCESS", refresh: "PRIVATE-REFRESH", expires: Date.now() + 3600_000,
  authMethod: "social", authRegion: "us-east-1", ...patch,
});
const signal = () => AbortSignal.timeout(5000);
const sample = {
  nextDateReset: 1_900_000_000, daysUntilReset: 12,
  subscriptionInfo: { subscriptionTitle: "KIRO PRO+", type: "Q_DEVELOPER_STANDALONE_PRO_PLUS", overageCapability: "OVERAGE_CAPABLE" },
  userInfo: { email: "user@example.test", userId: "PRIVATE-USER" },
  overageConfiguration: { overageStatus: "DISABLED" },
  usageBreakdownList: [{
    resourceType: "CREDIT", displayName: "Credit", displayNamePlural: "Credits",
    currentUsage: 120, currentUsageWithPrecision: 120.37, usageLimit: 2000, usageLimitWithPrecision: 2000,
    freeTrialInfo: { freeTrialStatus: "ACTIVE", currentUsageWithPrecision: 10, usageLimitWithPrecision: 500, freeTrialExpiry: 1_910_000_000 },
    bonuses: [{ status: "ACTIVE", displayName: "Welcome bonus", currentUsage: 5, usageLimit: 50, expiresAt: 1_905_000_000 },
      { status: "EXPIRED", displayName: "Old", currentUsage: 0, usageLimit: 100 }],
  }],
  secret: "PRIVATE-RAW",
};

test("Kiro quota uses one AWS JSON GetUsageLimits POST on the profile service region", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const quota = await fetchKiroQuota(credential({ profileArn: arn }), signal(), async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(sample);
  });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls, headers = new Headers(init?.headers), body = JSON.parse(String(init?.body));
  assert.equal(url, "https://q.eu-central-1.amazonaws.com/");
  assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
  assert.equal(headers.get("x-amz-target"), "AmazonCodeWhispererService.GetUsageLimits");
  assert.equal(headers.get("content-type"), "application/x-amz-json-1.0");
  assert.equal(headers.get("authorization"), "Bearer PRIVATE-ACCESS");
  assert.deepEqual(body, { origin: "KIRO_CLI", resourceType: "AGENTIC_REQUEST", isEmailRequired: true, profileArn: arn });
  assert.equal(quota.plan, "KIRO PRO+"); assert.equal(quota.email, "user@example.test"); assert.equal(quota.overageEnabled, false);
  assert.deepEqual(quota.buckets.map(bucket => [bucket.kind, bucket.used, bucket.limit]), [["base", 120.37, 2000], ["free-trial", 10, 500], ["bonus", 5, 50]]);
  assert.equal(quota.buckets[0].resetsAt, 1_900_000_000_000); assert.equal(quota.buckets[0].unit, "Credits");
  assert.equal(quota.buckets[1].expiresAt, 1_910_000_000_000); assert.equal(quota.buckets[2].name, "Welcome bonus");
  assert.ok(!JSON.stringify(quota).includes("PRIVATE"));
});

test("enterprise accounts without profile resolve their own profile first; ambiguous profile stops", async () => {
  const targets: string[] = [];
  await fetchKiroQuota(credential({ authMethod: "identity-center" }), signal(), async (_url, init) => {
    const target = new Headers(init?.headers).get("x-amz-target")!; targets.push(target);
    return target.endsWith("ListAvailableProfiles") ? Response.json({ profiles: [{ arn }] }) : Response.json(sample);
  });
  assert.deepEqual(targets, ["AmazonCodeWhispererService.ListAvailableProfiles", "AmazonCodeWhispererService.GetUsageLimits"]);
  await assert.rejects(fetchKiroQuota(credential({ authMethod: "identity-center" }), signal(), async () =>
    Response.json({ profiles: [{ arn }, { arn: arn.replace("test-profile", "other") }] })), (error: unknown) => error instanceof KiroQuotaError && error.kind === "profile");
});

test("parser drops malformed and inactive members instead of guessing", () => {
  const quota = parseKiroQuota({ subscriptionInfo: { subscriptionTitle: "<script>" }, userInfo: { email: "bad" },
    usageBreakdownList: [{ currentUsage: -1, usageLimit: "100", bonuses: [{ status: "ACTIVE", usageLimit: Infinity }] }, "junk"] });
  assert.equal(quota.plan, undefined); assert.equal(quota.email, undefined);
  assert.deepEqual(quota.buckets.map(bucket => [bucket.kind, bucket.used, bucket.limit]), [["base", null, null], ["bonus", null, null]]);
  assert.throws(() => parseKiroQuota({ usageBreakdownList: {} }), KiroQuotaError);
  assert.throws(() => parseKiroQuota([]), KiroQuotaError);
});

test("adapter maps to account card DTO and safe failures without upstream text", async () => {
  assert.ok(supportsProviderUsage("kiro"));
  const ok = await queryKiroUsage("kiro", credential(), signal(), async () => Response.json(sample));
  assert.equal(ok.status, "ready"); assert.equal(ok.accountStatus?.state, "active");
  assert.deepEqual(ok.account, { email: "user@example.test", plan: "KIRO PRO+" });
  const base = ok.metrics[0];
  assert.equal(base.kind, "quota"); assert.equal(base.label, "套餐额度");
  assert.equal(usageMetricValue(base), "120.37 / 2,000 Credits");
  assert.ok(Math.abs(usageMetricPercent(base)! - 6.0185) < 1e-3);
  assert.ok(hasQuotaRecord(ok));
  // Cache round trip keeps plan text with "+" and quota metrics.
  assert.deepEqual(publicUsage(JSON.parse(JSON.stringify(ok)), "kiro"), ok);
  for (const [status, state] of [[401, "unauthorized"], [403, "unknown"], [429, "unknown"], [503, "unknown"]] as const) {
    const failed = await queryKiroUsage("kiro", credential(), signal(), async () => new Response("PRIVATE-UPSTREAM", { status }));
    assert.equal(failed.status, "unavailable"); assert.equal(failed.accountStatus?.state, state); assert.equal(failed.metrics.length, 0);
    assert.ok(failed.message && !failed.message.includes("PRIVATE"));
  }
  const network = await queryKiroUsage("kiro", credential(), signal(), async () => { throw Error("PRIVATE-NET"); });
  assert.match(network.message!, /无法连接/);
  const large = await queryKiroUsage("kiro", credential(), signal(), async () => new Response("x".repeat(300 * 1024)));
  assert.match(large.message!, /无效或超出大小限制/);
});

test("caller cancellation propagates instead of returning a cached-looking failure", async () => {
  const controller = new AbortController();
  const pending = queryKiroUsage("kiro", credential(), controller.signal, (_url, init) => new Promise((_resolve, reject) =>
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true })));
  controller.abort();
  await assert.rejects(pending);
});

test("live GetUsageLimits shape (2026-10, KIRO PRO+, synthetic values) maps to one base credit bucket", async () => {
  // Field set observed in a read-only live query; identifiers and email replaced. Extra members must be ignored.
  const live = {
    daysUntilReset: 0, limits: [], nextDateReset: 1793491200,
    overageConfiguration: { __type: "com.amazon.aws.codewhisperer#OverageConfiguration", overageStatus: "DISABLED" },
    subscriptionInfo: { overageCapability: "OVERAGE_CAPABLE", subscriptionManagementTarget: "MANAGE", subscriptionTitle: "KIRO PRO+", type: "Q_DEVELOPER_STANDALONE_PRO_PLUS", upgradeCapability: "UPGRADE_INCAPABLE" },
    usageBreakdownList: [{ bonuses: [], currency: "USD", currentOverages: 0, currentOveragesWithPrecision: 0, currentUsage: 1658, currentUsageWithPrecision: 1658.14,
      displayName: "Credit", displayNamePlural: "Credits", nextDateReset: 1793491200, overageCap: 10000, overageCapWithPrecision: 10000, overageCharges: 0,
      overageCredits: [], overageRate: 0.04, resourceType: "CREDIT", unit: "INVOCATIONS", usageLimit: 2000, usageLimitWithPrecision: 2000 }],
    userInfo: { __type: "com.amazon.aws.codewhisperer#UserInfo", email: "user@example.test", userId: "PRIVATE-USER-ID" },
  };
  const usage = await queryKiroUsage("kiro", credential(), signal(), async () => Response.json(live));
  assert.equal(usage.status, "ready");
  assert.deepEqual(usage.account, { email: "user@example.test", plan: "KIRO PRO+" });
  assert.deepEqual(usage.metrics, [{ id: "CREDIT:base", kind: "quota", label: "套餐额度", used: 1658.14, limit: 2000, unit: "Credits", resetsAt: 1793491200000 }]);
  assert.ok(!JSON.stringify(usage).includes("PRIVATE"));
});
