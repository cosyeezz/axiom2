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
/**
 * Read an item timestamp without inventing one. Replay uses this strict form
 * so legacy JSONL records that predate durable timestamps do not acquire a
 * different time on every load.
 */
export declare function readPersistedAcpItemTimestamp(item: unknown): number | undefined;
export declare function withAcpTimestampRecord(meta: Record<string, unknown> | undefined, timestamp?: number, compatibilityExtensions?: boolean): Record<string, unknown>;
export declare function withAcpTimestampMeta<T extends Record<string, unknown>>(payload: T, timestamp?: number, compatibilityExtensions?: boolean): T;
/**
 * Put event time on the logical update for canonical ACP. The compatibility
 * facade also keeps the notification-envelope timestamp consumed by existing
 * WorkBuddy clients.
 */
export declare function withAcpSessionUpdateTimestamp<T extends Record<string, unknown> & {
    update: Record<string, unknown>;
}>(payload: T, timestamp?: number, compatibilityExtensions?: boolean): T;
