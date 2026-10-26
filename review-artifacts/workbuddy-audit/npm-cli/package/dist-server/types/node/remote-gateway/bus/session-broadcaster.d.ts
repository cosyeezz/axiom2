/**
 * Fan-out for the WebSocket bus: one stream's events reach every page that
 * subscribed to it.
 *
 * The gateway is the single owner of a conversation, so "several pages watching
 * one agent" is a fan-out problem, not an ownership problem — there is no writer
 * lease to hand around. Two practical concerns shape the implementation:
 *
 *  - **Batching.** A busy turn emits hundreds of deltas a second; writing each
 *    one as its own frame wastes syscalls and makes the browser's main thread do
 *    per-frame work. Events are coalesced per subscriber and flushed on a short
 *    interval (or immediately when a batch fills up).
 *  - **Backpressure.** A stalled page (laptop asleep, debugger paused) must not
 *    grow the gateway's memory. A subscriber whose queue crosses the high-water
 *    mark loses its backlog, and recovery differs per stream kind: a conversation
 *    is told to resync from its snapshot, while an app stream is healed by its
 *    producer re-anchoring (one full-state frame) — the page never resyncs a
 *    stream the server can simply re-send (contract §5).
 */
import { type BusResyncReason, type BusServerFrame, type BusStreamCursor } from './bus-protocol';
import { type BusEventJournal, type BusJournalAppendOptions } from './event-journal';
export interface BusSubscriber {
    send(frame: BusServerFrame): void;
    /** Dynamic object-level authorization checked before replay and delivery. */
    isAuthorized?(streamId: string): boolean;
}
export interface BusStreamResyncInstruction {
    streamId: string;
    reason: BusResyncReason;
    currentSeq: number;
}
export interface BusSubscribeResult {
    /** Streams now streaming live (their cursors were bridged). */
    accepted: string[];
    /** Streams that could not be bridged; a resync frame was already sent. */
    resync: BusStreamResyncInstruction[];
}
export interface BusBroadcasterOptions {
    /** Coalescing window. Small enough to feel live, large enough to batch a turn. */
    flushIntervalMs?: number;
    /** Frames one flush may write before yielding to the next timer tick. */
    maxBatchSize?: number;
    /** Queued frames per subscriber before its backlog is dropped. */
    maxEventBufferSize?: number;
}
export declare const BUS_FLUSH_INTERVAL_MS = 20;
export declare const BUS_MAX_BATCH_SIZE = 128;
export declare class BusSessionBroadcaster {
    private readonly journal;
    private readonly options;
    private readonly states;
    /** App streams register a "publish a fresh anchor now" hook (see bus-runtime). */
    private readonly anchorRecovery;
    private timer;
    private disposed;
    constructor(journal: BusEventJournal, options?: BusBroadcasterOptions);
    /** Epoch of the journal behind this broadcaster; sent to clients on hello. */
    get epoch(): string;
    get maxEventBufferSize(): number;
    /**
     * Subscribe to streams and replay whatever the supplied cursors missed.
     *
     * Replay goes out synchronously (before any live frame) so a page can never
     * observe seq N+1 ahead of seq N. `requestId` is echoed on the resync frames
     * this subscription could not satisfy.
     */
    subscribe(subscriber: BusSubscriber, streamIds: readonly string[], cursors?: Record<string, BusStreamCursor>, requestId?: string): BusSubscribeResult;
    unsubscribe(subscriber: BusSubscriber, streamIds: readonly string[]): void;
    detach(subscriber: BusSubscriber): void;
    /**
     * Register how a stream heals from a dropped backlog. Presence of a hook is
     * what makes a stream "app-like": overflow re-anchors it instead of resyncing.
     */
    setAnchorRecovery(streamId: string, recover: (() => void) | null): void;
    /** Streams this subscriber is currently live on. */
    streamsOf(subscriber: BusSubscriber): string[];
    /** Publish one event to every subscriber of that stream. */
    publish(streamId: string, event: {
        event: string;
        data: unknown;
    }, options?: BusJournalAppendOptions): void;
    /**
     * Keep the journal's stream count bounded.
     *
     * The check is one map-size read per publish; the sweep itself only runs
     * once the ceiling is reached. Streams that must survive: the one being
     * published, anything with live subscribers, and the producer-backed
     * directory streams (their anchor is what late subscribers bootstrap from,
     * and the poller that would republish it idles while nobody watches).
     */
    private sweepStreams;
    /**
     * Tell every subscriber of a stream that its content was replaced.
     * The stream stops flowing until the client re-subscribes with a fresh anchor.
     */
    resyncStream(streamId: string, reason: BusResyncReason): void;
    /** Deliver queued frames now. `drain` is for control boundaries before authorization changes. */
    flushNow(drain?: boolean): void;
    /** Unique currently subscribed stream ids, optionally filtered by prefix. */
    subscribedStreamIds(prefix?: string): string[];
    subscriberCount(streamId?: string): number;
    dispose(): void;
    private stateFor;
    private frameFor;
    /**
     * Keep one subscriber's backlog bounded.
     *
     * Volatile frames are dropped first (they are explicitly not resumable);
     * if the queue is still over budget the whole backlog goes and every stream
     * it covered is told to resync. Either way the subscriber is never left
     * believing it holds a complete stream.
     */
    private enforceBackpressure;
    private pruneUnauthorized;
    private dropQueuedStream;
    private dropIdleState;
    /** Write immediately, bypassing the batch (control frames and replay). */
    private sendNow;
    private flushState;
    private scheduleFlush;
}
