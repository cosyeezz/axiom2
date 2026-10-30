import assert from "node:assert/strict";
import { test } from "node:test";
import { usageAnalytics } from "../src/server/usage-analytics.js";
import { emptyCostTotals, sumCosts } from "../src/shared/costs.js";
import type { UsageRecord } from "../src/shared/model-usage.js";
const row = (timestamp?: number, n = 1): UsageRecord => ({ ...emptyCostTotals(), id: String(n), workspaceId: `w${n}`, workspaceName: "同名空间", rootSessionId: "root", sessionTitle: "会话", sessionId: "root", category: "main", source: "模型", provider: `p${n}`, model: "same-id", name: "同名模型", kind: "call", records: 1, timestamp, knownCost: n / 10, tokens: { input: n, output: n, cacheRead: n, cacheWrite: 0 } });
test("calendar grouping respects browser time zone and DST, including empty days", () => {
  const a = usageAnalytics([row(Date.parse("2024-03-10T07:30Z")), row(Date.parse("2024-03-10T10:30Z")), row(Date.parse("2024-03-12T07:30Z"))], { timeZone: "America/Los_Angeles" });
  assert.equal(a.trend[0].from, "2024-03-09"); assert.deepEqual(a.trend.map(day => day.count), [1, 1, 0, 1]); assert.equal(a.bucketDays, 1);
  const b = usageAnalytics([row(Date.parse("2024-11-03T08:30Z")), row(Date.parse("2024-11-03T09:30Z"))], { timeZone: "America/Los_Angeles" });
  assert.deepEqual(b.trend.map(day => [day.from, day.count]), [["2024-11-03", 2]]);
  const c = usageAnalytics([row(Date.parse("2024-03-09T17:00Z"))], { timeZone: "Asia/Shanghai" });
  assert.equal(c.trend[0].from, "2024-03-10");
});
test("long ranges coarsen calendar buckets without truncation or lost totals", () => {
  const rows = [row(Date.parse("2000-01-01T00:00Z")), row(Date.parse("2026-01-01T00:00Z"), 2)];
  const a = usageAnalytics(rows, { timeZone: "UTC" });
  assert.ok(a.trend.length <= 60); assert.ok(a.bucketDays > 1); assert.equal(a.trend[0].from, "2000-01-01"); assert.equal(a.trend.at(-1)?.to, "2026-01-01");
  assert.deepEqual(sumCosts(a.trend.map(bucket => bucket.total)), sumCosts(rows));
  const empty = usageAnalytics([], { from: Date.parse("2024-01-01Z"), to: Date.parse("2024-01-03Z"), timeZone: "UTC" });
  assert.equal(empty.trend.length, 3); assert.ok(empty.trend.every(bucket => bucket.count === 0));
});
test("unknown timestamps stay outside the trend; unknown costs/tokens and estimates survive every grouping", () => {
  const a = row(); a.unknownTokens = 1; a.unknownCost = 1; a.estimatedRecords = 1; a.estimatedCost = .04; a.estimateSources = ["fixture"];
  const b = usageAnalytics([a], {});
  assert.equal(b.trend.length, 0); assert.equal(b.undated.count, 1); assert.deepEqual(b.undated.total, sumCosts([a]));
  for (const field of ["models", "providers", "workspaces"] as const) assert.deepEqual(b[field].cost[0].total, sumCosts([a]));
});
test("rankings use stable identities and metric-specific top five plus an exact other remainder", () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(Date.parse("2024-01-01Z"), i + 1));
  rows[0].knownCost = 99; rows[0].provider = null;
  const a = usageAnalytics(rows, {});
  assert.equal(a.models.cost[0].key, JSON.stringify([null, "same-id"]));
  assert.notEqual(a.models.tokens[0].key, a.models.cost[0].key);
  for (const field of ["models", "providers", "workspaces"] as const) for (const metric of ["tokens", "cost"] as const) {
    assert.equal(a[field][metric].length, 6); assert.equal(a[field][metric][5].other, true);
    assert.deepEqual(sumCosts(a[field][metric].map(group => group.total)), sumCosts(rows));
    assert.equal(a[field][metric].reduce((sum, group) => sum + group.count, 0), rows.length);
  }
});
