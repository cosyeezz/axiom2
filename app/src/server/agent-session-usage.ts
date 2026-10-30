import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";
import { kiroUsageInfo } from "../shared/kiro-usage.js";
import { currentContextUsage } from "./context-usage.js";
import { lastRequestUsage, latestRequestUsage } from "./request-usage.js";

/** Display projection only: token measurement, configured cost, and context limits are independent. */
export function agentSessionUsage(session: Pick<AgentSession, "getSessionStats" | "getContextUsage" | "sessionManager" | "model">): AgentInfo["usage"] {
  const stats = session.getSessionStats(), context = session.getContextUsage();
  const window = session.model?.contextWindow, kiro = session.model?.provider === "kiro";
  const kiroWindow = kiro && typeof window === "number" && Number.isFinite(window) && window > 0;
  if (!(stats.tokens.total > 0 || kiroWindow)) return null;
  const latest = latestRequestUsage(session.sessionManager), measurement = kiroUsageInfo(latest);
  const capacity = context?.contextWindow && Number.isFinite(context.contextWindow) && context.contextWindow > 0
    ? context.contextWindow : kiroWindow ? window : null;
  const display = capacity == null ? null : currentContextUsage(session.sessionManager, capacity, session.model?.provider);
  return { ...stats.tokens, cost: stats.cost > 0 ? stats.cost : null,
    lastRequest: lastRequestUsage(session.sessionManager),
    ...(measurement ? { lastMeasurement: measurement } : {}),
    context: display };
}
