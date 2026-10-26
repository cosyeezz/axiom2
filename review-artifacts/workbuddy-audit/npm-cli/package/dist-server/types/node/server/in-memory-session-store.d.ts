/**
 * In-memory SessionStore adapter — the dev/test adapter and the executable
 * reference of the adapter semantics: append is an atomic batch in arrival
 * order, `uuid` is the idempotency key (a re-appended uuid upserts in place),
 * `subpath` addresses subagent copies, load returns null for an unknown key.
 * Vendored surface of @anthropic-ai/claude-agent-sdk's InMemorySessionStore
 * (never imported; listSessionSummaries omitted — not in our contract).
 *
 * Also the reference implementation of the v2 lane capabilities
 * (docs/cloud-native/session-store-v2-spi.md): a tree-entry append advances
 * the lane tip inside the backend; fact entries never touch it; loadLane walks
 * the payload.parentId chain from the resolved start down to the segment
 * root and returns oldest-first.
 */
import type { Lane, LanePointer, SessionKey, SessionStore, SessionStoreEntry } from './types';
export declare class InMemorySessionStore implements SessionStore {
    private store;
    private mtimes;
    private tips;
    private keyToString;
    create(key: SessionKey): Promise<void>;
    append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
    load(key: SessionKey, opts?: {
        last?: number;
    }): Promise<SessionStoreEntry[] | null>;
    listSessions(projectKey: string): Promise<Array<{
        sessionId: string;
        mtime: number;
    }>>;
    delete(key: SessionKey): Promise<void>;
    listSubkeys(key: {
        projectKey: string;
        sessionId: string;
    }): Promise<string[]>;
    listLanes(key: SessionKey): Promise<LanePointer[]>;
    getLane(key: SessionKey, lane?: Lane): Promise<string | null>;
    moveLane(key: SessionKey, lane: Lane, to: string | null): Promise<void>;
    appendFactAndMoveLane(key: SessionKey, entries: SessionStoreEntry[], lane: Lane, to: string | null): Promise<void>;
    loadLane(key: SessionKey, lane?: Lane): Promise<SessionStoreEntry[]>;
    /** Test helper — all entries for a key, in stored order. */
    getEntries(key: SessionKey): SessionStoreEntry[];
    /** Test helper — number of stored transcripts (main and subagent copies). */
    size(): number;
}
