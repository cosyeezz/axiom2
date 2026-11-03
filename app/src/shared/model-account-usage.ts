import type { ProviderUsageMetric } from "./provider-usage.js";

/** Only known numerator/denominator contracts produce a progress value. */
export function usageMetricPercent(metric: ProviderUsageMetric): number | undefined {
  if (metric.kind === "window" && metric.usedPercent !== null && Number.isFinite(metric.usedPercent)) return Math.min(100, Math.max(0, metric.usedPercent));
  if (metric.kind === "tokens" && metric.used !== null && metric.remaining !== null && Number.isFinite(metric.used) && Number.isFinite(metric.remaining) && metric.used >= 0 && metric.remaining >= 0 && metric.used + metric.remaining > 0)
    return 100 * metric.used / (metric.used + metric.remaining);
  if (metric.kind === "quota" && metric.used !== null && metric.limit !== null && Number.isFinite(metric.used) && Number.isFinite(metric.limit) && metric.used >= 0 && metric.limit > 0)
    return Math.min(100, 100 * metric.used / metric.limit);
  return undefined;
}
