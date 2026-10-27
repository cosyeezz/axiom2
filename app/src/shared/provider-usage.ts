import { costParts, type CostPart } from "./costs.js";

export type UsageModelPricing = { model: string; prices: Partial<Record<CostPart, number>>; tiered?: boolean };
export function estimateTokenBalance(metric: Extract<ProviderUsageMetric, { kind: "tokens" }>, pricing: readonly UsageModelPricing[]) {
  const configured = pricing.find(row => row.model === metric.model);
  if (metric.remaining === null || !Number.isFinite(metric.remaining) || metric.remaining < 0 || !configured || configured.tiered) return;
  const rates = (metric.part ? [metric.part] : costParts).map(part => configured.prices[part]);
  if (!rates.every((rate): rate is number => typeof rate === "number" && Number.isFinite(rate) && rate >= 0)) return;
  const low = metric.remaining / 1_000_000 * Math.min(...rates), high = metric.remaining / 1_000_000 * Math.max(...rates);
  return Number.isFinite(low) && Number.isFinite(high) ? { low, high } : undefined;
}

export const usageRefreshMinimum = 30 * 60_000;
export const usageRefreshJitter = 10 * 60_000;

/** Read-only upstream account information. Never contains credentials or raw upstream payloads. */
export type ProviderUsageMetric =
  | { id: string; label: string; kind: "window"; usedPercent: number | null; windowSeconds?: number; resetsAt?: number }
  /** Only adapters with an absolute Token balance contract may emit this metric. Model is an exact local identity, never inferred from a percentage. */
  | { id: string; label: string; kind: "tokens"; model: string; used: number | null; remaining: number | null; part?: CostPart }
  | { id: string; label: string; kind: "balance"; balance: string | null; unlimited?: boolean }
  | { id: string; label: string; kind: "count"; count: number | null; expiresAt?: number };

export interface ProviderUsage {
  providerId: string;
  status: "ready" | "unavailable" | "unsupported";
  metrics: ProviderUsageMetric[];
  updatedAt?: number;
  /** Server-owned deadline, shared by viewers and restored from the local cache. */
  nextRefreshAt?: number;
  stale?: boolean;
  /** Safe, provider-owned diagnostic; never forward upstream response text. */
  message?: string;
  /** Explicit local limitation; false disables refresh/polling until configuration changes. */
  refreshable?: boolean;
  /** Provider-owned HTTPS management page; never contains credentials or account identifiers. */
  management?: { label: string; url: string };
}

export function usageMetricValue(metric: ProviderUsageMetric): string {
  if (metric.kind === "balance") return metric.unlimited ? "无限" : metric.balance ?? "—";
  if (metric.kind === "count") return metric.count === null ? "—" : `${metric.count} 次`;
  if (metric.kind === "tokens") return metric.remaining === null ? "—" : `${metric.remaining.toLocaleString("en-US")} Token`;
  return metric.usedPercent === null ? "—" : `${Number(metric.usedPercent.toFixed(1))}%`;
}
