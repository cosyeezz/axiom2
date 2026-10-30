import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyCostTotals } from "../src/shared/costs.js";
import type { ProviderUsage } from "../src/shared/provider-usage.js";
import { estimateQuotaWindow, quotaSamplePeriod, type QuotaSample, type QuotaWindow } from "../src/shared/quota-estimate.js";

const now = Date.UTC(2026, 9, 28, 12), hour = 3600000;
const window: QuotaWindow = { id: "primary_window", kind: "window", label: "5小时已用", usedPercent: 25, windowSeconds: 5 * 3600, resetsAt: now + hour };
const usage: ProviderUsage = { providerId: "openai", status: "ready", metrics: [window], updatedAt: now - 30 * 60000 };
const sample = (): QuotaSample => ({ partial: false, total: { ...emptyCostTotals(), records: 4, knownCost: 10, estimatedCost: 3, estimatedRecords: 2 } });

test("100% and remaining use the full sample's knownCost, not the estimated subset again", () => {
  assert.deepEqual(estimateQuotaWindow(25, sample()), { used: 10, total: 40, remaining: 30, records: 4 });
  assert.deepEqual(estimateQuotaWindow(100, sample()), { used: 10, total: 10, remaining: 0, records: 4 });
  const secondary = estimateQuotaWindow(50, { ...sample(), total: { ...sample().total, knownCost: 100 } });
  assert.deepEqual(secondary, { used: 100, total: 200, remaining: 100, records: 4 });
});

test("use the exact official sampling cutoff and inferred window start, not now or historical filters", () => {
  assert.deepEqual(quotaSamplePeriod(usage, window, now), { from: now - 4 * hour, to: now - hour / 2 });
  const weekly = { ...window, id: "secondary_window", windowSeconds: 7 * 86400, resetsAt: now + 2 * 86400000 };
  assert.deepEqual(quotaSamplePeriod(usage, weekly, now), { from: now - 5 * 86400000, to: usage.updatedAt });
});

test("unknown, zero, invalid and expired windows never establish entitlement", () => {
  for (const usedPercent of [null, 0, -1, 101, NaN, Infinity]) {
    assert.equal(quotaSamplePeriod(usage, { ...window, usedPercent }, now), undefined);
    assert.equal(estimateQuotaWindow(usedPercent, sample()), undefined);
  }
  for (const change of [{ stale: true }, { status: "unavailable" as const }, { updatedAt: undefined }, { updatedAt: 0 }, { updatedAt: NaN },
    { updatedAt: now + 1 }, { updatedAt: now - 5 * hour }]) assert.equal(quotaSamplePeriod({ ...usage, ...change }, window, now), undefined);
  for (const change of [{ resetsAt: undefined }, { resetsAt: now }, { resetsAt: now - 1 }, { resetsAt: Infinity }, { resetsAt: 9e15 },
    { resetsAt: hour }, { windowSeconds: undefined }, { windowSeconds: 0 }, { windowSeconds: -1 }, { windowSeconds: Infinity }, { windowSeconds: Number.MAX_VALUE }])
    assert.equal(quotaSamplePeriod(usage, { ...window, ...change }, now), undefined);
  assert.equal(quotaSamplePeriod(usage, window, window.resetsAt!), undefined);
  assert.equal(quotaSamplePeriod(usage, window, NaN), undefined);
});

test("partial, building, unpriced, unmeasured and empty samples stay unknown, not zero", () => {
  for (const change of [{ partial: true }, { building: true }]) assert.equal(estimateQuotaWindow(25, { ...sample(), ...change }), undefined);
  for (const change of [{ unknownCost: 1 }, { unknownTokens: 1 }, { records: 0 }, { records: 1.5 }, { knownCost: 0 }, { knownCost: -1 }, { knownCost: NaN }, { knownCost: Infinity }])
    assert.equal(estimateQuotaWindow(25, { ...sample(), total: { ...sample().total, ...change } }), undefined);
  // A valid total is usable even if per-part charges were not retained.
  assert.equal(estimateQuotaWindow(25, { ...sample(), total: { ...sample().total, unknownParts: 1 } })?.total, 40);
});

test("tiny positive amounts remain nonzero and arithmetic overflow is rejected", () => {
  const tiny = estimateQuotaWindow(.1, { ...sample(), total: { ...sample().total, knownCost: 1e-25 } })!;
  assert.ok(tiny.total > 0 && tiny.remaining > 0);
  assert.equal(estimateQuotaWindow(Number.MIN_VALUE, sample()), undefined);
  assert.equal(estimateQuotaWindow(1, { ...sample(), total: { ...sample().total, knownCost: Number.MAX_VALUE } }), undefined);
});
