import type { Lane, LanePointer, SessionKey, SessionStore, SessionStoreEntry, SessionSummaryEntry } from './session-store-contract';
export interface LocalJsonlSessionStoreOptions {
    /** Transcript root selected by the host. */
    storageRoot: string;
    /**
     * Injected by the kernel store so every transcript write shares one lock
     * domain (and storage-dir bootstrap). Standalone default: a per-file
     * promise-chain lock.
     */
    withFileLock?: <T>(filePath: string, operation: () => Promise<T>) => Promise<T>;
    /**
     * Injected transcript line writer (kernel: the audited write with
     * partial-batch rollback; the key carries audit context). Standalone
     * default: a single appendFile.
     */
    writeLines?: (filePath: string, lines: string[], key: SessionKey) => Promise<void>;
    /**
     * Contract semantics (default true): a chain entry whose payload omits
     * parentId gets the current tip assigned by storage, an explicit
     * parentId: null re-anchors a segment root (stored as absence), and a
     * string parentId is validated against the tip (fail-loud). The kernel
     * embedding sets false — its linkage processor has already assigned
     * parentId (absence there MEANS segment root), so storage only advances
     * the tip and never touches or validates the payload.
     */
    assignParentIds?: boolean;
    /**
     * Contract semantics (default true): a redelivered uuid is absorbed,
     * which requires the per-key uuid index (one full-file read on the first
     * touch of a key). The kernel embedding sets false — the kernel never
     * redelivers, so its append path skips the index and the cold read.
     */
    absorbRedeliveries?: boolean;
}
export declare class LocalJsonlSessionStore implements SessionStore {
    private readonly storageRoot;
    private readonly injectedLock?;
    private readonly writeLines?;
    private readonly assignParentIds;
    private readonly absorbRedeliveries;
    private writeLocks;
    /** Lazy per-key state: known uuids (append idempotency) and the main tip. */
    private uuids;
    private tips;
    constructor(options: LocalJsonlSessionStoreOptions);
    private keyToString;
    private filePathFor;
    private withFileLock;
    private readLines;
    /** Load per-key state (uuid set + heuristic tip) from disk, once per key. */
    private ensureKeyState;
    create(key: SessionKey): Promise<void>;
    append(key: SessionKey, entries: SessionStoreEntry[]): Promise<void>;
    load(key: SessionKey, opts?: {
        last?: number;
    }): Promise<SessionStoreEntry[] | null>;
    listSessions(projectKey: string): Promise<Array<{
        sessionId: string;
        mtime: number;
    }>>;
    listSessionSummaries(projectKey: string): Promise<SessionSummaryEntry[]>;
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
}
//# sourceMappingURL=local-jsonl-session-store.d.ts.map