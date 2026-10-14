import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { estimateTokens, type SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";

type ContextUsage = NonNullable<AgentInfo["usage"]>["context"];

/** Current-context fallback for display and Axiom's automatic trigger; never changes billing or pi's summary algorithm. */
export function contextUsage(manager: SessionManager, context: ContextUsage): ContextUsage {
  if (!context || context.tokens != null || !Number.isFinite(context.window) || context.window <= 0)
    return context;
  // Estimate the committed projection, not the summary snapshot or old assistant
  // usage (retained assistants still carry pre-compaction provider measurements).
  const { messages } = manager.buildSessionProjection();
  // System entries are deltas: replaced sections and removed tools must not
  // contribute again. Fold them with the same public helper used by native pi.
  const system = getCurrentSystemMessage(messages);
  const tokens = messages.reduce(
    (total, message) => total + (message.role === "system" ? 0 : estimateTokens(message)),
    system ? estimateTokens(system) : 0,
  );
  return { tokens, window: context.window, percent: tokens / context.window * 100, estimated: true };
}
