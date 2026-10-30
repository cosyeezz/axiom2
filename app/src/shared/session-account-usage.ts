import type { ProviderUsage } from "./provider-usage.js";

/** A credential-path binding, never a credential, execution environment or upstream account identifier. */
export interface SessionAccountTarget {
  providerId: string;
  /** undefined resolves the next execution's default; null explicitly means the original auth slot. */
  accountId?: string | null;
  /** Internal guard for a proven request credential; never returned in SessionAccountUsage. */
  credentialKey?: string;
  source: "execution" | "next-execution";
  identity: string;
}
export interface SessionAccountUsage {
  identity: string;
  providerId: string;
  source: SessionAccountTarget["source"];
  account: { id?: string; label: string; email?: string; plan?: string };
  usage: ProviderUsage;
}

/** Query support, an empty successful response, and unknown values are not quota records. Zero is valid. */
export function hasQuotaRecord(usage: ProviderUsage | undefined, now = Date.now()): usage is ProviderUsage {
  if (usage?.status !== "ready" || !Number.isFinite(usage.updatedAt) || usage.updatedAt! <= 0 || usage.updatedAt! > now) return false;
  const known = (n: number | null) => n !== null && Number.isFinite(n) && n >= 0;
  return usage.metrics.some(metric => metric.kind === "window" ? known(metric.usedPercent) && metric.usedPercent! <= 100
    : metric.kind === "tokens" ? known(metric.remaining)
    : metric.kind === "count" ? known(metric.count) && Number.isInteger(metric.count)
    : metric.unlimited === true || metric.hasCredits === false || metric.balance !== null && /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(metric.balance));
}
