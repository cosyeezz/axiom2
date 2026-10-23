import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";

type RequestUsage = NonNullable<NonNullable<AgentInfo["usage"]>["lastRequest"]>;

/** Read the latest actual request, including attempts omitted from model context. */
export function lastRequestUsage(manager: SessionManager): RequestUsage | null {
  const branch = manager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    const usage = entry.message.usage;
    if (!usage) return null;
    const { input, cacheRead, cacheWrite } = usage;
    const total = input + cacheRead + cacheWrite;
    // Missing/invalid usage on a newer attempt must not reuse an older hit rate.
    if (![input, cacheRead, cacheWrite, total].every(n => Number.isFinite(n) && n >= 0) || total === 0)
      return null;
    return { input, cacheRead, cacheWrite };
  }
  return null;
}
