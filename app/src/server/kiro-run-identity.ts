import { usesKiroResponses, KIRO_CONTINUATION_METADATA } from "./providers/kiro-responses.js";

/** Host-owned logical execution identity, not a physical request ID or a hash of user content. */
export type KiroRunIdentity = { sessionId: string; continuationId: string };

/** Do not guess how official cross-run recovery preserves graph state. */
export function freshKiroRunIdentity(input: { runId: string; resume?: boolean; memoryContinuation?: boolean;
  notification?: unknown; reloadId?: string; compressionPreparation?: string }, sessionId: string): KiroRunIdentity | undefined {
  return input.resume || input.memoryContinuation || input.notification || input.reloadId || input.compressionPreparation
    ? undefined : { sessionId, continuationId: input.runId };
}

export function withKiroRunIdentity<T extends { sessionId?: string; metadata?: Record<string, unknown> } | undefined>(
  model: { api: string; id: string }, options: T, identity?: KiroRunIdentity,
): T {
  if (!identity || model.api !== "kiro-chat" || !usesKiroResponses(model.id) || options?.sessionId !== identity.sessionId) return options;
  return { ...options, metadata: { ...options.metadata, [KIRO_CONTINUATION_METADATA]: identity.continuationId } } as T;
}
