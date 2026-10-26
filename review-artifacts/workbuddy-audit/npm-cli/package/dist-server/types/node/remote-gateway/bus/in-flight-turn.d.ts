/**
 * In-flight turn tracking for the Web UI agent bus (contract §3/§4).
 *
 * The tracker is the server-side authority for "what is running right now" in a
 * session. It is fed the same ACP `session/update` increments that pages receive;
 * the durable transcript stays authoritative for history, so this module never
 * touches disk or the event journal.
 *
 * The tracker itself is pure (no bus/cell/RxJS imports) so it stays unit-testable;
 * the only bus edges are the small publisher at the bottom of this file
 * (`publishSessionUpdateToBus`) which is shared by every ACP send path.
 */
/** `_meta` key carrying the server-generated turn lifecycle marker (contract §3). */
export declare const ACP_META_TURN = "codebuddy.ai/turn";
/** `_meta` key carrying the per-turn conversation request id (cbc-core contract). */
export declare const ACP_META_REQUEST_ID = "codebuddy.ai/conversationRequestId";
/**
 * Older frames (and `buildAcpSessionEndUpdate`) stamp the shorter
 * `codebuddy.ai/requestId` key instead; both identify the same turn.
 */
export declare const ACP_META_REQUEST_ID_LEGACY = "codebuddy.ai/requestId";
export type InFlightProgressKind = 'stdout' | 'stderr' | 'progress' | 'status' | 'custom';
export interface InFlightToolProgress {
    kind: InFlightProgressKind;
    text?: string;
    percent?: number;
}
export interface InFlightToolCall {
    toolCallId: string;
    name: string;
    args?: unknown;
    description?: string;
    lastProgress?: InFlightToolProgress;
}
/** Contract §2 snapshot shape (camelCase, server-owned). */
export interface InFlightTurn {
    turnId: number;
    assistantText: string;
    thinkingText: string;
    assistantMessageId?: string;
    thinkingMessageId?: string;
    runningTools: InFlightToolCall[];
    currentPromptId?: string;
}
export interface TurnTransition {
    phase: 'started' | 'ended';
    turnId: number;
    promptId?: string;
}
export interface SessionUpdateLike {
    sessionUpdate?: unknown;
    _meta?: unknown;
    [key: string]: unknown;
}
export interface ApplySessionUpdateResult {
    /** Offset of this delta inside the accumulated text (volatile frames carry it, contract §1). */
    offset?: number;
    /**
     * Lifecycle transitions produced by this update, in publish order:
     * a superseding `started` may follow the `ended` of the previous turn.
     */
    transitions: TurnTransition[];
}
/** Flatten an ACP content block (or block array) into its text. */
export declare function extractTextContent(content: unknown): string;
/**
 * Contract §3: chunk frames plus agentPhase/progress frames are volatile —— kept in
 * memory for live delivery but never replayed to a reconnecting page. Everything
 * else (tool/config/end/goal/compact frames) is durable.
 */
export declare function isVolatileSessionUpdate(update: SessionUpdateLike): boolean;
/** Build the server-generated turn lifecycle frame (contract §3, same ACP notification shape). */
export declare function buildTurnTransitionUpdate(transition: TurnTransition): Record<string, unknown>;
/**
 * Accumulates the in-flight turn of every session from ACP `session/update` frames.
 *
 * Semantics (contract §4, aligned with kimi `inFlightTurnTracker`):
 * - the first turn-content frame of a new `conversationRequestId` opens a turn;
 * - `session_end` closes it (the tracker is cleared);
 * - a frame carrying a different request id closes the previous turn and opens the next
 *   one (a superseding run must not blend two turns into one text buffer);
 * - sub-agent and compaction-internal frames are observable on the bus but never enter
 *   the main turn's accumulators.
 */
export declare class InFlightTurnTracker {
    private readonly bySession;
    private readonly turnCounters;
    /** Feed one outgoing session update; returns the volatile offset and lifecycle transitions. */
    apply(sessionId: string, update: SessionUpdateLike): ApplySessionUpdateResult;
    private accumulate;
    private applyToolCall;
    private applyToolCallUpdate;
    /** Contract §2 `inFlightTurn`: null when no run is in flight for the session. */
    snapshot(sessionId: string): InFlightTurn | null;
    /** Drop the tracked turn (session recreated / explicit reset). */
    clear(sessionId: string): void;
    hasActiveTurn(sessionId: string): boolean;
}
export declare function getInFlightTurnTracker(): InFlightTurnTracker;
export declare function resetInFlightTurnTrackerForTests(): void;
/**
 * Bus payload for one `session/update` (contract §3).
 *
 * Shape A settled by team-lead + frozen contract §3: the bus envelope's inner
 * `event` is `notification` and its data is the complete ACP JSON-RPC
 * notification (`jsonrpc/method/params`). The client's `readBusSessionUpdate`
 * accepts both A and B, but A is the canonical one — the client feeds it back into
 * the very same `handleMessage` pipeline ACP replay uses, so live events and replay
 * share one parser end to end.
 */
export declare function sessionUpdateBusEvent(sessionId: string, update: unknown): {
    event: string;
    data: unknown;
};
/** Safety net when a replay never sends its `end` marker. */
export declare const REPLAY_SUPPRESSION_MAX_MS: number;
export declare function isSessionReplaySuppressed(sessionId: string): boolean;
/** Test seam. */
export declare function resetReplaySuppressionForTests(): void;
/** Same update object inside this window counts as one publication. */
export declare const PUBLISH_DEDUPE_WINDOW_MS = 5000;
/** Test seam: a WeakMap cannot be cleared in place. */
export declare function resetPublishedSessionUpdatesForTests(): void;
/**
 * Publish one outgoing ACP `session/update` onto the session bus and feed the
 * in-flight turn tracker (contract §3/§4). Returns true when this call published
 * the frame (false for duplicates, non-updates and a disabled bus).
 *
 * Turn lifecycle frames are emitted *before* the content frame of the same call:
 * a page learns that a turn started before it receives the first delta of that turn.
 */
export declare function publishSessionUpdateToBus(sessionId: string, update: SessionUpdateLike): boolean;
/**
 * Force-close the tracked turn for one session and publish the ended transition.
 *
 * Cancel is the one terminal path that never emits `session_end`: the run is
 * aborted before a prompt-completion frame exists, so the tracker keeps the
 * aborted turn's accumulated text forever. The next snapshot then still reports
 * `inFlightTurn`, and a refreshed page restores a run that is already over —
 * the page shows "running" while the server is idle.
 *
 * Clearing the tracker is what makes the REST snapshot honest again; the
 * published transition is what makes already-open pages converge without a
 * reload. Returns true when a tracked turn was closed.
 */
export declare function endInFlightTurnForSession(sessionId: string, reason?: string): boolean;
