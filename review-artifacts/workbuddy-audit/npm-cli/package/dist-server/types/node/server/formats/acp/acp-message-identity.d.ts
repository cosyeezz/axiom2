export type AcpAssistantMessageKind = 'agent' | 'thought';
/**
 * Resolve the request correlation owned by one live model generation.
 *
 * The request-local event snapshot wins over mutable session state, which can
 * already belong to a concurrent request. A provider response ID is retained
 * for older model adapters without either correlation source. This generation
 * correlation is separate from the message/reasoning entry IDs reserved by
 * withModelMessageCorrelation and reused by history persistence.
 *
 * Deliberately do not invent a random fallback here. A random wire id could
 * satisfy the schema while making the same item acquire a different id when
 * history is replayed.
 */
export declare function resolveAcpGenerationMessageId(event: unknown, sessionMessageId: unknown): string | undefined;
/**
 * Derive the canonical wire identity for one assistant-side logical message.
 *
 * The format is an Agent CLI implementation detail. ACP clients must treat the
 * returned value as opaque and compare it only for equality.
 */
export declare function deriveCanonicalAcpMessageId(kind: AcpAssistantMessageKind, durableIdentity: string): string;
export declare function canonicalizeStandardMessageId(update: {
    messageId?: string | null;
    sessionUpdate?: string;
}, fallbackIdentity?: string): void;
/**
 * Remove pre-standard prompt/message correlation aliases from canonical wire
 * metadata. Internal runtime tracking may still use these concepts, but ACP
 * exposes run identity as requestId and message identity as top-level
 * messageId.
 */
export declare function stripLegacyPromptCorrelationMeta(meta: Record<string, unknown>): Record<string, unknown>;
/**
 * Clone an ACP payload and remove compatibility-only correlation metadata from
 * its logical `_meta` carrier. Empty metadata is omitted instead of emitting
 * `_meta: {}` on canonical wire.
 */
export declare function stripLegacyPromptCorrelationFromPayload<T extends Record<string, unknown>>(payload: T): T;
