import type { CostTotals } from "./costs.js";
import type { ProviderUsage, ProviderUsageMetric } from "./provider-usage.js";

export type QuotaWindow = Extract<ProviderUsageMetric, { kind: "window" }>;
export type QuotaPeriod = { from: number; to: number };
export type QuotaSample = { total: CostTotals; partial: boolean; building?: boolean };
export type QuotaEstimate = { used: number; total: number; remaining: number; records: number };

/** Reference sample only: percentages do not establish an absolute Token or dollar entitlement. */
export function quotaSamplePeriod(usage: ProviderUsage, window: QuotaWindow, now = Date.now()): QuotaPeriod | undefined {
  const { updatedAt } = usage, { windowSeconds, resetsAt, usedPercent } = window;
  if (usage.status !== "ready" || usage.stale || usage.accountStatus && usage.accountStatus.state !== "active" || !Number.isFinite(now) ||
      typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > now ||
      typeof windowSeconds !== "number" || !Number.isFinite(windowSeconds) || windowSeconds <= 0 ||
      typeof resetsAt !== "number" || !Number.isFinite(resetsAt) || resetsAt > 8.64e15 || now >= resetsAt ||
      typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent <= 0 || usedPercent > 100) return;
  const from = resetsAt - windowSeconds * 1000;
  // Match the official sample's cutoff, not today's history or the current wall clock.
  return Number.isFinite(from) && from >= 0 && from <= updatedAt && updatedAt < resetsAt ? { from, to: updatedAt } : undefined;
}

/** knownCost already includes estimatedCost. Never add that subset again or extrapolate an incomplete sample. */
export function estimateQuotaWindow(usedPercent: number | null, sample: QuotaSample): QuotaEstimate | undefined {
  const { total } = sample;
  if (sample.building || sample.partial || total.unknownCost !== 0 || total.unknownTokens !== 0 ||
      !Number.isSafeInteger(total.records) || total.records <= 0 || !Number.isFinite(total.knownCost) || total.knownCost <= 0 ||
      usedPercent === null || !Number.isFinite(usedPercent) || usedPercent <= 0 || usedPercent > 100) return;
  const amount = total.knownCost / (usedPercent / 100), remaining = amount * ((100 - usedPercent) / 100);
  return Number.isFinite(amount) && Number.isFinite(remaining)
    ? { used: total.knownCost, total: amount, remaining, records: total.records } : undefined;
}
