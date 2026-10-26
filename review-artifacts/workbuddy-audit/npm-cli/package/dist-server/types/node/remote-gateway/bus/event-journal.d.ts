/**
 * Per-stream event history for the WebSocket bus.
 *
 * Scope is deliberately small: this is a *reconnect bridge*, not an audit log.
 * A page that drops off keeps its cursors and asks for everything after them; the
 * ring is bounded so a long conversation cannot grow memory without limit. When
 * the ring can no longer prove continuity the reader is told to resync from the
 * snapshot API instead of silently missing events.
 *
 * Persistence is intentionally out of scope: the gateway process owns the
 * journal (see `epoch`), a restart invalidates cursors and every page resyncs
 * from the snapshot on disk. That keeps this file free of rotation, fsync and
 * multi-writer concerns nothing in the product needs yet.
 *
 * Two kinds of streams share this journal:
 *
 *  - Conversation streams (streamId = sessionId): a plain bounded ring.
 *  - App streams (app:jobs / app:agent-home): state-shaped, so the producer
 *    periodically publishes a `snapshot` frame. That frame is the stream's
 *    *anchor*: it subsumes everything older, which is what lets a late
 *    subscriber receive current state without replaying hours of diffs.
 */
import type { BusResyncReason } from './bus-protocol';
export interface BusJournalEntry {
    /**
     * Durable frames get the next number; volatile frames ride at the current
     * watermark (contract §7). The client therefore only ever has to prove
     * continuity for durable frames — a chunk that vanished was never numbered.
     */
    seq: number;
    event: {
        event: string;
        data: unknown;
    };
    /** Start offset of this delta inside the accumulated text (volatile chunks). */
    offset?: number;
    /** Token-level delta: delivered live, never retained, never numbered. */
    volatile?: boolean;
    ts: string;
}
export interface BusJournalAppendOptions {
    /** Token-level deltas are delivered live but never retained. */
    volatile?: boolean;
    /** Start offset of this delta inside the accumulated text. */
    offset?: number;
    /**
     * Marks a full-state frame (app streams). It becomes the stream anchor and
     * the older durable frames stop being reachable, because replaying them
     * would be redundant: the anchor already carries their result.
     */
    snapshot?: boolean;
}
export interface BusJournalReadResult {
    entries: BusJournalEntry[];
    /** Non-null when continuity cannot be proven; the caller must resync. */
    reason: BusResyncReason | null;
    /** Highest seq the stream has handed out — the anchor to resync against. */
    currentSeq: number;
}
/** Retained events per stream. Enough to cover a page reload, bounded on purpose. */
export declare const BUS_JOURNAL_MAX_ENTRIES_PER_STREAM = 500;
/**
 * Retained streams at once. Every stream's ring is already bounded, but the
 * daemon is long-lived and dead conversations never remove theirs (`forget`
 * has no production caller), so the stream count itself needs a ceiling: past
 * it, the least-recently-appended streams are dropped. A page whose cursor
 * pointed into a dropped stream resyncs (`cursor.seq < droppedThrough` ⇒
 * `buffer_overflow`), never silently loses frames. The directory streams are
 * pinned by the broadcaster (they have no natural end), keeping their anchor
 * available for late subscribers.
 */
export declare const BUS_JOURNAL_MAX_STREAMS = 256;
export declare class BusEventJournal {
    private readonly maxEntriesPerStream;
    /** Process-lifetime id: cursors are only meaningful inside one epoch. */
    readonly epoch: string;
    private readonly entriesByStream;
    private readonly lastSeqByStream;
    /** Highest durable seq evicted from the ring (no anchor to fall back on). */
    private readonly droppedThroughByStream;
    /** Latest full-state frame per app stream; older frames become unreachable. */
    private readonly anchorByStream;
    /** Seq at which a stream was recreated; cursors below it are stale. */
    private readonly recreatedThroughByStream;
    /** Last durable append per stream — the eviction order for `sweep`. */
    private readonly lastAppendAtByStream;
    constructor(maxEntriesPerStream?: number, epoch?: string);
    /**
     * Record an event for one stream.
     *
     * Only durable frames advance `seq`; a volatile frame carries the current
     * watermark and leaves it untouched, so "what the page has" and "what the
     * journal can prove" are the same number (contract §7).
     */
    append(streamId: string, event: {
        event: string;
        data: unknown;
    }, options?: BusJournalAppendOptions): BusJournalEntry;
    /** Highest `seq` handed out for a stream (0 when it never published). */
    lastSeq(streamId: string): number;
    /**
     * Everything the supplied cursor still needs, or the reason it cannot be
     * bridged.
     *
     * `cursor` absent means "no resume point": the reader only wants what
     * happens next, except on a stream with an anchor, where the anchor *is* the
     * current state and is handed over instead.
     */
    readSince(streamId: string, cursor?: {
        seq: number;
        epoch?: string;
    }): BusJournalReadResult;
    /**
     * The stream's content was replaced (session recreated / history reset):
     * cursors from before this point describe a different conversation.
     */
    markStreamRecreated(streamId: string): void;
    /**
     * Release a swept stream's payload but keep its cursors honest.
     *
     * The retained frames are the memory problem, so those go; `seq` keeps
     * counting from where the stream left off instead of restarting at 1, which
     * would let a stale cursor that happens to equal the new `lastSeq` pass the
     * `cursor.seq > lastSeq` check and silently miss a frame. Cursors below the
     * watermark resync loudly; one sitting exactly on it already has everything.
     */
    private evict;
    /** Drop a stream's history once it is gone for good. */
    forget(streamId: string): void;
    /** Retained stream count — the growth axis `sweep` bounds. */
    streamCount(): number;
    /**
     * Drop the oldest streams once `entriesByStream` exceeds `maxStreams`.
     *
     * `isProtected` marks streams that must survive the pass: the one being
     * appended to, streams with live subscribers, and the producer-backed
     * directory streams (an swept anchor would leave a late subscriber with
     * no baseline). Eviction reuses `forget`, so old cursors fail loud
     * (`epoch_changed`) instead of silently missing frames.
     */
    sweep(maxStreams: number, isProtected: (streamId: string) => boolean): void;
    /** Retained entry count across streams — used by tests and diagnostics. */
    retainedCount(): number;
    private entriesAfter;
}
