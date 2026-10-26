import type { SessionStoreEntry } from './session-store-contract';
/** A transcript jsonl line: the persisted item itself, verbatim. */
export interface TranscriptLine {
    type?: string;
    id?: string;
    parentId?: string;
    logicalParentId?: string;
    timestamp?: number;
    [key: string]: unknown;
}
/** Facts never advance the lane; every other entry is a tree entry and does. */
export declare function isFactType(type: string | undefined): boolean;
/** Wrap a stored line into the wire envelope (uuid ≡ line.id). */
export declare function toEnvelope(line: TranscriptLine): SessionStoreEntry;
/**
 * Mint the wire envelope for a host-store append: uuid via entryUuidOf
 * (except snapshot facts, whose legacy id can collide with a user entry),
 * a fresh ISO timestamp, and a
 * deep-cloned payload (a remote adapter serializes anyway; an in-memory
 * adapter must not observe later item mutation).
 */
export declare function toStoreEntry(item: unknown): SessionStoreEntry | undefined;
/**
 * Walk the parentId chain from `start` down to its natural end (the segment
 * root), returning oldest-first. Tolerates a broken link (the walk ends) and
 * guards against cycles.
 */
export declare function walkBranch(byId: Map<string, TranscriptLine>, start: string): TranscriptLine[];
/**
 * Recover the active tip from transcript facts using the replay resolver.
 * A trailing rewind marker selects its parent (or an empty root); after a new
 * conversation entry is written, the new branch tail becomes the tip.
 * Metadata never advances the tip, and no in-memory lastMessageId is required.
 */
export declare function resolveTip(lines: TranscriptLine[]): string | null;
//# sourceMappingURL=transcript-branch.d.ts.map