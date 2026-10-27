/** Context-invisible native summary attempts not covered by a successful checkpoint. */
export const kiroCompactionAttemptKind = "kiro_compaction_attempt";

/** Serializable measurement provenance. Configured prices are estimates, never a service bill. */
export type KiroMeasurement = "unknown" | "partial" | "complete";
export interface KiroRates { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface KiroPriceSnapshot extends KiroRates { tiers?: (KiroRates & { inputTokensAbove: number })[] }
export interface KiroRequestUsageInfo {
  version: 1;
  scope: "request";
  state: KiroMeasurement;
  pricing: {
    kind: "unknown" | "configured-estimate";
    rates?: KiroPriceSnapshot;
    inputTokensAbove?: number;
  };
}
export interface KiroSummaryUsageInfo {
  version: 1;
  scope: "summary";
  state: KiroMeasurement;
  pricing: { kind: "unknown" | "configured-estimate" };
  /** Successful summary requests only; failed/retried attempts have their own physical ledger. */
  requests: KiroRequestUsageInfo[];
}
export type KiroUsageInfo = KiroRequestUsageInfo | KiroSummaryUsageInfo;

const parts = ["input", "output", "cacheRead", "cacheWrite"] as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const state = (value: unknown): value is KiroMeasurement => value === "unknown" || value === "partial" || value === "complete";
const rates = (value: unknown): value is KiroRates => record(value) && parts.every(key => number(value[key]));
export function validKiroPriceSnapshot(value: unknown): value is KiroPriceSnapshot {
  return rates(value) && (!("tiers" in value) || value.tiers === undefined ||
    Array.isArray(value.tiers) && value.tiers.every(tier => record(tier) && rates(tier) && number(tier.inputTokensAbove)));
}
export function hasKiroUsage(value: unknown): boolean { return record(value) && Object.hasOwn(value, "axiomKiro"); }
function request(value: unknown): value is KiroRequestUsageInfo {
  if (!record(value) || value.version !== 1 || value.scope !== "request" || !state(value.state) || !record(value.pricing)) return false;
  const price = value.pricing;
  if (price.kind !== "unknown" && price.kind !== "configured-estimate" ||
      price.rates !== undefined && !validKiroPriceSnapshot(price.rates) ||
      price.inputTokensAbove !== undefined && !number(price.inputTokensAbove)) return false;
  if (price.kind === "unknown") return true;
  if (!validKiroPriceSnapshot(price.rates)) return false;
  const selected = price.inputTokensAbove === undefined ? price.rates
    : price.rates.tiers?.find(tier => tier.inputTokensAbove === price.inputTokensAbove);
  return !!selected && parts.some(key => selected[key] > 0);
}
/** Invalid/unsupported markers must be treated as unknown, not as legacy zero usage. */
export function kiroUsageInfo(usage: unknown): KiroUsageInfo | undefined {
  if (!record(usage)) return;
  const value = usage.axiomKiro;
  if (request(value)) return value;
  if (!record(value) || value.version !== 1 || value.scope !== "summary" || !state(value.state) ||
      !record(value.pricing) || !Array.isArray(value.requests) || !value.requests.every(request)) return;
  const requests = value.requests;
  const measured = requests.length && requests.every(item => item.state === "complete") ? "complete"
    : requests.every(item => item.state === "unknown") ? "unknown" : "partial";
  const priced = measured === "complete" && requests.every(item => item.pricing.kind === "configured-estimate");
  if (value.state !== measured || value.pricing.kind !== (priced ? "configured-estimate" : "unknown")) return;
  return value as unknown as KiroSummaryUsageInfo;
}
