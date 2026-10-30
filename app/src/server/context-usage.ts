import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { buildSessionProjection, calculateContextTokens, estimateTokens, type SessionEntry, type SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentInfo } from "../shared/agent.js";
import type { ContextMeasurement } from "../shared/context-usage.js";
import { hasKiroUsage, kiroUsageInfo } from "../shared/kiro-usage.js";

type ContextUsage = NonNullable<AgentInfo["usage"]>["context"];

/** System entries are deltas, not independent copies of the effective prompt. */
export function estimateContextMessages(messages: ReturnType<typeof buildSessionProjection>["messages"]): number {
  const system = getCurrentSystemMessage(messages);
  return messages.reduce(
    (total, message) => total + (message.role === "system" ? 0 : estimateTokens(message)),
    system ? estimateTokens(system) : 0,
  );
}

/** One occupancy rule for live display, automatic thresholds and frozen snapshots.
 * Mirrors Pi 1.1's projected-context rule using only public SDK APIs. A later
 * context edit/compaction invalidates earlier usage, even on retained messages.
 * Does not change the transcript, provider requests, billing or native summaries.
 */
export function measureContext(entries: SessionEntry[], options: { provider?: string; forceEstimate?: boolean } = {}): ContextMeasurement {
  const projection = buildSessionProjection(entries);
  let forceEstimate = options.forceEstimate;
  const latest = entries.findLast((entry) => entry.type === "message" && entry.message.role === "assistant");
  const provider = options.provider ?? projection.model?.provider ??
    (latest?.type === "message" && latest.message.role === "assistant" ? latest.message.provider : undefined);
  if (latest?.type === "message" && latest.message.role === "assistant" &&
      (provider === "kiro" || hasKiroUsage(latest.message.usage))) {
    const usage = latest.message.usage;
    // Partial reports can retain older numeric components. Complete zero also
    // must not fall back to an older nonzero response. Keep lastRequest separate.
    if (hasKiroUsage(usage) && (kiroUsageInfo(usage)?.state !== "complete" || usage.totalTokens === 0))
      forceEstimate = true;
  }
  if (!forceEstimate) {
    const invalidatingIndex = entries.findLastIndex((entry) => entry.type === "context_edit" || entry.type === "compaction");
    let messageIndex = projection.messages.length;
    for (let i = projection.entries.length - 1; i >= 0; i--) {
      const projected = projection.entries[i];
      for (let j = projected.messages.length - 1; j >= 0; j--) {
        messageIndex--;
        const message = projected.messages[j];
        if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") continue;
        // Validate the selected baseline's own provenance too. A newer failed
        // request or a provider switch must not revive older partial Kiro data.
        if (hasKiroUsage(message.usage) && (kiroUsageInfo(message.usage)?.state !== "complete" || message.usage.totalTokens === 0))
          return { tokens: estimateContextMessages(projection.messages), source: "message-estimate" };
        const tokens = calculateContextTokens(message.usage);
        if (!Number.isFinite(tokens) || tokens <= 0) continue;
        const sourceIndex = entries.findIndex((entry) => entry.id === projected.sourceEntry.id);
        // Only the latest eligible usage is considered, just as in Pi. An older
        // one cannot become valid if the latest one predates the invalidation.
        if (sourceIndex > invalidatingIndex) return {
          tokens: tokens + projection.messages.slice(messageIndex + 1).reduce((n, tail) => n + estimateTokens(tail), 0),
          source: "model-usage",
        };
        return { tokens: estimateContextMessages(projection.messages), source: "message-estimate" };
      }
    }
  }
  return { tokens: estimateContextMessages(projection.messages), source: "message-estimate" };
}

export function currentContextUsage(manager: Pick<SessionManager, "getBranch">, window: number, provider?: string): ContextUsage {
  if (!Number.isFinite(window) || window <= 0) return null;
  const measurement = measureContext(manager.getBranch(), { provider });
  return { ...measurement, window, percent: measurement.tokens / window * 100,
    ...(measurement.source === "message-estimate" ? { estimated: true } : {}) };
}

/** Recover saved unknown readings without trusting retained pre-compaction usage.
 * Existing native readings remain intact; live measurements use currentContextUsage.
 */
export function contextUsage(manager: SessionManager, context: ContextUsage): ContextUsage {
  if (!context || context.tokens != null || !Number.isFinite(context.window) || context.window <= 0)
    return context;
  const measurement = measureContext(manager.getBranch(), { forceEstimate: true });
  return { ...measurement, window: context.window, percent: measurement.tokens / context.window * 100, estimated: true };
}
