export const CODEBUDDY_CONTINUATION_METADATA = "codebuddy:conversation_request_id";
export const CODEBUDDY_IDENTITY_METADATA = "codebuddy:invocation_identity";

/** Host execution identity, separate from each physical invocation's request/message ID. */
export type CodeBuddyRunIdentity = { sessionId: string; continuationId: string };
export function freshCodeBuddyRunIdentity(input: { runId: string; resume?: boolean; memoryContinuation?: boolean;
  notification?: unknown; reloadId?: string; compressionPreparation?: string }, sessionId: string): CodeBuddyRunIdentity | undefined {
  // Cross-run recovery and synthetic auxiliary ownership have not been established.
  return input.resume || input.memoryContinuation || input.notification || input.reloadId || input.compressionPreparation
    ? undefined : { sessionId, continuationId: input.runId };
}
export function withCodeBuddyRunIdentity<T extends { sessionId?: string; metadata?: Record<string, unknown> } | undefined>(
  model: { provider: string; api: string }, options: T, identity?: CodeBuddyRunIdentity,
): T {
  if (!identity || model.provider !== "codebuddy-cn" || model.api !== "openai-completions" || options?.sessionId !== identity.sessionId) return options;
  return { ...options, metadata: { ...options.metadata, [CODEBUDDY_CONTINUATION_METADATA]: identity.continuationId } } as T;
}
