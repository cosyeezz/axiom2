/**
 * SessionStore contract — the storage abstraction the kernel depends on
 * directly and hosts implement (design: docs/cloud-native/session-store-v2-spi.md).
 * The base shape follows the Claude Agent SDK adapter contract; the v2 lane
 * capabilities are optional methods with capability detection.
 *
 * Neutral home: both the kernel session layer and the /server host surface
 * import from here (server/types re-exports for the published host face).
 */
export interface SessionKey {
    projectKey: string;
    sessionId: string;
    /** Undefined addresses the main transcript; subagent copies set a subpath. */
    subpath?: string;
}
export interface SessionStoreEntry {
    type: string;
    uuid?: string;
    timestamp?: string;
    [key: string]: unknown;
}
export interface SessionSummaryEntry {
    sessionId: string;
    mtime: number;
    data: Record<string, unknown>;
}
/** The default lane; every session has it. */
export declare const MAIN_LANE = "main";
/**
 * A lane identifier. `(string & {})` keeps IDE literal completion for 'main'
 * while accepting any string (future lane names; for loadLane, also a node id).
 */
export type Lane = typeof MAIN_LANE | (string & {});
/** A named branch pointer row. Today exactly one per session: 'main'. */
export interface LanePointer {
    lane: Lane;
    tip: string | null;
}
export interface SessionStore {
    /** Ensure an empty transcript exists, without changing existing history or lane pointers. */
    create?(key: SessionKey): Promise<void>;
    append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
    /**
     * Full-transcript read (every stored line, storage order). opts.last is
     * an ADVISORY tail bound (GraphQL pagination vocabulary: the most recent
     * N entries): a backend may push it down (e.g. a reverse tail read) or
     * ignore it and return everything — pre-existing implementations do.
     * Callers must tolerate a longer result and re-slice defensively.
     */
    load(key: SessionKey, opts?: {
        last?: number;
    }): Promise<SessionStoreEntry[] | null>;
    listSessions?(projectKey: string): Promise<Array<{
        sessionId: string;
        mtime: number;
    }>>;
    listSessionSummaries?(projectKey: string): Promise<SessionSummaryEntry[]>;
    delete?(key: SessionKey): Promise<void>;
    listSubkeys?(key: {
        projectKey: string;
        sessionId: string;
    }): Promise<string[]>;
    /** Enumerate lanes. Today: always one row, the default lane 'main'. */
    listLanes?(key: SessionKey): Promise<LanePointer[]>;
    /**
     * Pointer read — the lane's tip entry uuid (lane defaults to 'main').
     * null = empty lane (unborn: a fresh session, or reverted to the start).
     */
    getLane?(key: SessionKey, lane?: Lane): Promise<string | null>;
    /**
     * Durable pointer move. Called ONLY when the tip moves without an append
     * (conversation revert; fork relocation) — a chain append advances the
     * lane by itself, inside the backend. to: null = to the session start;
     * the next chain append becomes a new root.
     */
    moveLane?(key: SessionKey, lane: Lane, to: string | null): Promise<void>;
    /**
     * Lane read: down the parentId chain to its natural end (the segment
     * root), oldest-first (load's order). The lane argument accepts a lane
     * NAME ('main', the default) — reads from that lane's tip — or an entry
     * uuid — reads from that entry, covering branches no pointer references.
     * Resolution happens backend-side: exact lane name first, then entry
     * uuid; an unresolvable value rejects. Future query axes join as a third
     * parameter.
     */
    loadLane?(key: SessionKey, lane?: Lane): Promise<SessionStoreEntry[]>;
    /**
     * Atomic fact-append + lane-move (issue #59319).
     *
     * Persists `entries` (which MUST all be fact-type — the backend asserts
     * this) and moves the lane pointer to `to` as a single atomic unit:
     *
     *   - Success: entries are durably stored AND the lane points to `to`.
     *   - Failure: neither the entries nor the lane are modified (on the
     *     local backend a failed file write is rolled back via
     *     truncate/unlink; the in-memory tip reverts to its prior value).
     *
     * The caller is responsible for updating in-memory session state (history,
     * subjects, pointers) ONLY after this method resolves successfully.
     *
     * This is NOT a general-purpose "append + move" — it is purpose-built
     * for the resend-fork-notice tombstone flow where the notice (a fact
     * entry, off-chain) and the lane rewind must land together or not at all.
     */
    appendFactAndMoveLane?(key: SessionKey, entries: SessionStoreEntry[], lane: Lane, to: string | null, options?: {
        persistLocal?: boolean;
    }): Promise<void>;
}
//# sourceMappingURL=session-store-contract.d.ts.map