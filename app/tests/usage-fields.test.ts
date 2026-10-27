import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCostTotals, sumCosts } from "../src/shared/costs.js";
import { defaultUsageColumns, normalizeUsageView, readUsageView, usageCacheHit, usageColumns, usageCostPart, usageInputTotal, usagePricingLabel } from "../src/client/usage-fields.js";

const measured = () => ({ ...emptyCostTotals(), records: 1, knownCost: 1, tokens: { input: 200, output: 100, cacheRead: 300, cacheWrite: 500 } });
test("usage view defaults compact, filters unknown and duplicate fields in stable schema order", () => {
  assert.deepEqual(normalizeUsageView(null), { columns: defaultUsageColumns, density: "compact" });
  assert.deepEqual(normalizeUsageView({ columns: ["cacheHit", "bogus", "cacheHit", "time"], density: "comfortable" }), { columns: ["time", "cacheHit"], density: "comfortable" });
  assert.deepEqual(normalizeUsageView({ columns: [], density: "huge" }).columns, defaultUsageColumns);
  assert.deepEqual(normalizeUsageView({ columns: [null, "amount", 1] }).columns, ["amount"]);
  assert.equal(new Set(usageColumns.map(column => column.id)).size, usageColumns.length);
  const defaults = normalizeUsageView(null); defaults.columns.length = 0;
  assert.ok(normalizeUsageView(null).columns.length > 0, "default selections must not share mutable arrays");
});
test("usage view storage is bounded and degrades safely when disabled or corrupt", () => {
  for (const value of [null, "{", "x".repeat(8193), "null", "[]"]) assert.deepEqual(readUsageView({ getItem: () => value }), normalizeUsageView(null));
  assert.deepEqual(readUsageView({ getItem: () => { throw Error("storage disabled"); } }), normalizeUsageView(null));
  assert.deepEqual(readUsageView({ getItem: () => '{"columns":["output"],"density":"comfortable"}' }), { columns: ["output"], density: "comfortable" });
});
test("cache hit rate is an input-token ratio including writes as misses, not output or requests", () => {
  const total = measured();
  assert.equal(usageInputTotal(total), 1000); assert.equal(usageCacheHit(total), 30);
  total.tokens.output = 9000; assert.equal(usageCacheHit(total), 30, "output cannot inflate the prompt denominator");
  total.tokens.cacheRead = 0; assert.equal(usageCacheHit(total), 0, "measured no cache reads is genuinely zero");
  total.tokens.input = 0; total.tokens.cacheWrite = 0; total.tokens.cacheRead = 10; assert.equal(usageCacheHit(total), 100);
});
test("cache ratio refuses missing, zero denominator, negative and non-finite token data", () => {
  assert.equal(usageInputTotal(undefined), undefined); assert.equal(usageCacheHit(undefined), undefined);
  const total = measured();
  total.unknownTokens = 1; assert.equal(usageInputTotal(total), undefined); assert.equal(usageCacheHit(total), undefined);
  total.unknownTokens = 0; total.records = 0; assert.equal(usageCacheHit(total), undefined);
  total.records = -1; assert.equal(usageCacheHit(total), undefined); total.records = 1;
  for (const invalid of [-1, NaN, Infinity]) { total.tokens.output = invalid; assert.equal(usageCacheHit(total), undefined); }
  total.tokens = { input: 0, output: 10, cacheRead: 0, cacheWrite: 0 }; assert.equal(usageInputTotal(total), 0); assert.equal(usageCacheHit(total), undefined);
  total.tokens = { input: Number.MAX_VALUE, output: 1, cacheRead: Number.MAX_VALUE, cacheWrite: 1 }; assert.equal(usageCacheHit(total), undefined);
});
test("aggregate cache ratios are weighted token sums rather than mean row percentages", () => {
  const first = measured(), second = measured(); first.tokens = { input: 0, cacheRead: 10, cacheWrite: 0, output: 1 }; second.tokens = { input: 90, cacheRead: 0, cacheWrite: 0, output: 1 };
  assert.equal(usageCacheHit(sumCosts([first, second])), 10);
  second.unknownTokens = 1; assert.equal(usageCacheHit(sumCosts([first, second])), undefined);
});
test("cost parts require complete historical breakdown; estimates stay a subset, not an extra fee", () => {
  const total = measured(); total.parts.input = .0000001;
  assert.equal(usageCostPart(total, "input"), .0000001);
  total.unknownParts = 1; assert.equal(usageCostPart(total, "input"), undefined);
  total.unknownParts = 0; total.parts.input = NaN; assert.equal(usageCostPart(total, "input"), undefined);
  assert.equal(usagePricingLabel(total), "已记录金额");
  total.estimatedRecords = 1; total.estimatedCost = .25; assert.equal(usagePricingLabel(total), "含参考估算"); assert.equal(total.knownCost, 1);
  total.unknownCost = 1; assert.equal(usagePricingLabel(total), "部分计价 · 含估算"); total.knownCost = 0; assert.equal(usagePricingLabel(total), "未计价");
});
