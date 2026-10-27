import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";
import { hasKiroUsage, kiroUsageInfo } from "../shared/kiro-usage.js";

type RequestUsage = NonNullable<NonNullable<AgentInfo["usage"]>["lastRequest"]>;

/** Read the latest actual request, including attempts omitted from model context. */
export function latestRequestUsage(manager: SessionManager) {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "message" && entry.message.role === "assistant") return entry.message.usage;
  }
}
export function lastRequestUsage(manager: SessionManager): RequestUsage | null {
  const usage = latestRequestUsage(manager);
  if (!usage) return null;
  const kiro = hasKiroUsage(usage), measurement = kiroUsageInfo(usage);
  if (kiro && measurement?.state !== "complete") return null;
  const { input, cacheRead, cacheWrite } = usage;
  const total = input + cacheRead + cacheWrite;
  // Never backfill a newer unknown attempt with an older cache hit rate. A
  // complete Kiro zero is a measurement; legacy/unmarked zero retains old rules.
  if (![input, cacheRead, cacheWrite, total].every(n => Number.isFinite(n) && n >= 0) || total === 0 && !kiro)
    return null;
  return { input, cacheRead, cacheWrite };
}
