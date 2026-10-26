export interface AcpHistoryMarker {
    startedAt: number;
    existingIds: ReadonlySet<string>;
    existingItems: ReadonlySet<object>;
}
/**
 * Snapshot the history boundary for one prompt without relying on an array
 * index. Recovery/compaction may replace or truncate the history array while
 * a prompt is running, but persisted item ids remain stable.
 */
export declare function createAcpHistoryMarker(history: ReadonlyArray<unknown>, startedAt?: number): AcpHistoryMarker;
/**
 * Resolve the completion time from persisted assistant-side records only.
 * Custom title/snapshot metadata and user/system messages are deliberately
 * excluded so an asynchronous metadata write cannot extend a turn.
 */
export declare function getLatestAcpOutputTimestamp(history: ReadonlyArray<unknown>, marker?: AcpHistoryMarker): number | undefined;
export declare function resolveAcpTimestamp(value?: unknown, fallback?: number): number;
export declare function getAcpItemTimestamp(item: unknown, fallback?: number): number;
export declare function withAcpTimestampRecord(meta: Record<string, unknown> | undefined, timestamp?: number): Record<string, unknown>;
export declare function withAcpTimestampMeta<T extends Record<string, unknown>>(payload: T, timestamp?: number): T;
/**
 * Build the existing WorkBuddy terminal extension without inventing a clock
 * value. When no replay-visible persisted output exists, omit timestamp so a
 * live consumer cannot derive a completion time that replay cannot reproduce.
 */
export declare function buildAcpSessionEndUpdate(requestId?: string, timestamp?: number, stopReason?: 'end_turn' | 'cancelled' | 'refusal'): {
    sessionUpdate: string;
    [key: string]: unknown;
};
