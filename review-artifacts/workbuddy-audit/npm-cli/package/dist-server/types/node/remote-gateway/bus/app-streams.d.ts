/**
 * Producers for the app-level streams the bus carries (app:jobs / app:agent-home).
 *
 * The conversations on the bus are driven by ACP itself; the *directory* streams
 * are not session-scoped at all. They used to exist only as SSE endpoints, which
 * meant their data was produced only while some page held an SSE open. A bus page
 * does not hold those SSEs any more, so the gateway has to keep producing: one
 * poller here computes the same frames the SSE endpoints compute and publishes
 * them onto reserved stream ids.
 *
 * Two properties make the stream usable by a page that joins late or reconnects:
 *
 *  - **Projection diff.** Only display-relevant fields take part in the change
 *    decision (heartbeat-ish fields such as `updatedAt` do not), and one tick's
 *    added/changed/removed entries leave as a *single* frame instead of one
 *    frame per entry.
 *  - **Anchor snapshots.** Every `BUS_APP_SNAPSHOT_EVERY_TICKS` passes the
 *    producer re-publishes the whole list as a `snapshot`. That frame becomes the
 *    stream's anchor in the journal, so a fresh subscriber gets current state
 *    without replaying minutes of diffs (see `event-journal.ts`).
 */
import { BUS_APP_AGENT_HOME_STREAM, BUS_APP_JOBS_STREAM } from './bus-protocol';
/** Snapshot + diff cadence for the directory streams (matches the SSE endpoints). */
export declare const BUS_APP_STREAM_INTERVAL_MS = 1000;
/** Liveness tick; mirrors the SSE endpoints' keepalive. Volatile: never retained. */
export declare const BUS_APP_STREAM_KEEPALIVE_MS = 15000;
/** Collection passes between two anchor snapshots (~1 minute at 1s cadence). */
export declare const BUS_APP_SNAPSHOT_EVERY_TICKS = 60;
export interface AppStreamPublishOptions {
    volatile?: boolean;
    /** Marks a full-state frame; the journal makes it the stream anchor. */
    snapshot?: boolean;
}
/** Write one frame onto an app stream (see `bus-runtime.publishBusEvent`). */
export type AppStreamPublisher = (streamId: string, event: string, data: unknown, options?: AppStreamPublishOptions) => void;
/**
 * Fields the jobs list renders.
 *
 * `updatedAt` moves on every heartbeat. Arbitrary `detail` summaries can
 * change while the worker streams, and phase labels change several times per
 * turn. Only the transition between a phase and a summary takes part in the
 * change decision, so a completed reply is not stuck behind the minute anchor.
 */
export declare const JOB_DISPLAY_FIELDS: readonly ["state", "tempo", "status", "settled", "sessionId", "detail", "name", "pid", "alive", "webUrl", "idleSince", "updatedAt", "lastActivityAt"];
/** Subset of {@link JOB_DISPLAY_FIELDS} that decides whether an entry changed. */
export declare const JOB_JUDGEMENT_FIELDS: readonly ["state", "tempo", "status", "settled", "sessionId", "name", "pid", "alive", "webUrl", "idleSince"];
/** Stable key for one entry's change decision: present judgement fields only. */
export declare function projectJobEntry(entry: Record<string, unknown>): string;
export interface AppStreamDiff<T> {
    added: T[];
    changed: T[];
    removed: string[];
}
export interface ProjectedDiffResult<T> {
    /** Set on the first pass: the whole list, which replaces client state. */
    snapshot: T[] | null;
    diff: AppStreamDiff<T>;
    next: Map<string, string>;
}
/**
 * Diff two collections against the display projection.
 *
 * The first pass returns the entries as a snapshot; later passes return only the
 * movements, with whole entries as payload (the client replaces its copy) while
 * the change decision itself was made on the projection.
 */
export declare function diffProjectedEntries<T extends {
    id: string;
}>(previous: Map<string, string> | null, entries: readonly T[], project?: (entry: T) => string): ProjectedDiffResult<T>;
export interface BusAppStream {
    stop(): void;
    /** Run one collection pass immediately (tests, and the first-page bootstrap). */
    refreshNow(): Promise<void>;
}
export interface LoggerLike {
    warn?(message: string): void;
}
export interface AppStreamCommonOptions {
    publish: AppStreamPublisher;
    intervalMs?: number;
    keepaliveMs?: number;
    snapshotEveryTicks?: number;
    logger?: LoggerLike;
    /**
     * 当前是否有页面订阅这条流。没有订阅者时，一秒一次的采集（读 JobStore 等）
     * 只会写进 journal 等一个永远不来的重放者，于是干脆不做；首个订阅者到来时，
     * 广播层的引导（见 `BusSessionBroadcaster.subscribe`）会先 `refreshNow()`
     * 补一份锚点快照，随后定时器恢复工作。
     */
    isActive?: () => boolean;
}
export interface PollingAppStreamOptions<T extends {
    id: string;
}> extends AppStreamCommonOptions {
    streamId: string;
    collect: () => Promise<readonly T[]>;
    project?: (entry: T) => string;
}
/**
 * Poll a collection and publish its changes.
 *
 * Only the bus owns this poller, so frames are computed once for every
 * subscriber instead of once per SSE connection.
 */
export declare function startPollingAppStream<T extends {
    id: string;
}>(options: PollingAppStreamOptions<T>): BusAppStream;
export interface DocumentAppStreamOptions<T> extends AppStreamCommonOptions {
    streamId: string;
    /** Read the current payload (undefined = surface disabled / nothing to send). */
    read: () => Promise<T | undefined>;
    /** Change key for the payload; ignore heartbeat fields (`at` and friends). */
    project: (payload: T) => string;
}
/**
 * Poll a single document-shaped payload and publish it when its projection moves.
 *
 * Agent Home activity is one object (agents/channels/jobAssignments/counts), not a
 * list, so the delta is "the payload changed" rather than per-entry movements —
 * the client replaces its copy, exactly like the SSE `changed` frame did.
 */
export declare function startDocumentAppStream<T>(options: DocumentAppStreamOptions<T>): BusAppStream;
/** Change key for the Agent Home activity payload: everything except its heartbeat. */
export declare function projectAgentHomeActivity(payload: unknown): string;
export { BUS_APP_AGENT_HOME_STREAM, BUS_APP_JOBS_STREAM };
