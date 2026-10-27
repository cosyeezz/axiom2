import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";
import { hasKiroUsage, kiroUsageInfo } from "../shared/kiro-usage.js";
import { contextUsage } from "./context-usage.js";
import { lastRequestUsage, latestRequestUsage } from "./request-usage.js";

/** Display projection only: token measurement, configured cost, and context limits are independent. */
export function agentSessionUsage(session: Pick<AgentSession, "getSessionStats" | "getContextUsage" | "sessionManager" | "model">): AgentInfo["usage"] {
  const stats = session.getSessionStats(), context = session.getContextUsage();
  const window = session.model?.contextWindow, kiro = session.model?.provider === "kiro";
  const kiroWindow = kiro && typeof window === "number" && Number.isFinite(window) && window > 0;
  if (!(stats.tokens.total > 0 || kiroWindow)) return null;
  const latest = latestRequestUsage(session.sessionManager), measurement = kiroUsageInfo(latest);
  let display = context ? { tokens: context.tokens, window: context.contextWindow, percent: context.percent } : null;
  if (kiroWindow) {
    if (!display || !Number.isFinite(display.window) || display.window <= 0)
      display = { tokens: null, window, percent: null };
    // Pi sees required numeric zeros, but doesn't know their measurement marker.
    // Retained numbers after a partial snapshot are not precise current context.
    // Pi also skips measured zero and can fall back to older usage: mark that estimate.
    if (hasKiroUsage(latest) && (measurement?.state !== "complete" || latest?.totalTokens === 0))
      display = { tokens: null, window, percent: null };
  }
  return { ...stats.tokens, cost: stats.cost > 0 ? stats.cost : null,
    lastRequest: lastRequestUsage(session.sessionManager),
    ...(measurement ? { lastMeasurement: measurement } : {}),
    context: contextUsage(session.sessionManager, display) };
}
