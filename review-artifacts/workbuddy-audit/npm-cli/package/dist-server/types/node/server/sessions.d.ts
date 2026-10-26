import { type RequestOwner, Session } from '../../vendor/cbc-core/node/index.js';
import { type CancelBackgroundTaskOutcome, type CancelBackgroundTaskResult } from '../acp/acp-background-task-cancel';
import { type BackgroundTaskSnapshot } from '../acp/acp-background-tasks';
import type { FormattedSessionEvent, QueryInput, QueryOptions, QueryTicket, RecoveryTicket, ReloadOptions, RewindOptions, RewindResult, SessionOutputFormat, SessionSubscription, SteerOptions, SteerResult, SubscribeOptions } from './types';
interface SettleOutcome {
    finishReason?: string;
    owner?: RequestOwner;
    assistantText: string;
    completedError?: unknown;
    permissionDenied?: boolean;
    cancelled?: boolean;
}
/**
 * Submit input or a maintenance operation: creates the session on first touch, resumes it
 * otherwise. The ticket carries the run id synchronously — it is the kernel
 * conversationRequestId, preassigned via pendingConversationRequestId.
 */
export declare function query(sessionId: string, input: QueryInput, options?: QueryOptions): QueryTicket;
/** Recover the current failed request without creating another user input. */
export declare function recover(sessionId: string, expectedRequestId: string, options?: QueryOptions): RecoveryTicket;
/** Set the next-turn security review envelope without activating an Agent. */
export declare function setSecurityReviewConfig(sessionId: string, config: unknown): Promise<import('@genie/product').SecurityReviewConfigEnvelope>;
/** Mark components stale without activating the session or interrupting its turn. */
export declare function reload(sessionId: string, options?: ReloadOptions): void;
/** Add input to an existing query. Rejection never creates or activates a session. */
export declare function steer(sessionId: string, input: string | unknown[], options: SteerOptions): Promise<SteerResult>;
/**
 * Settlement discipline (ordered signal): the primary lane subscribes to the
 * kernel's combine result/interrupt_result events, emitted only AFTER the
 * run's bookkeeping (error item into history, Stop hooks); retried failures
 * are suppressed and the recovery run emits its own (#64101, same gate
 * discipline as stream-json-view). Each result is judged by its stamped
 * interceptorGate — willRetry (and not __cancelNudge / retry-abandoned / cancelled-terminal) means not terminal.
 * interrupt_result settles immediately without awaiting `completed` (it may
 * never resolve on that path). The completed-promise loop remains as a raced,
 * stale-aware fallback with a grace window for terminal or pre-dispatch
 * failures. A gate that promises continuation must instead await an actual
 * result or ordered interrupt; a pending permission is not a timeout failure.
 * Never pump the item stream here; the kernel's per-session subscription is
 * its consumer.
 */
export declare function beginSettle(session: Session, isInterrupted: () => boolean, requestId?: string): {
    wait(): Promise<SettleOutcome>;
    admitOwner(owner: RequestOwner): void;
    dispose(): void;
};
/**
 * Turn-level cancellation: the in-flight ticket resolves normally with
 * stopReason 'aborted', never rejects. Resolves after the run state settles.
 */
export declare function interrupt(sessionId: string): Promise<void>;
/** Stop one owned background terminal without interrupting or queuing behind a query. */
export declare function cancelBackgroundTask(sessionId: string, terminalId: string): Promise<CancelBackgroundTaskResult>;
/** Observe retained background tasks without activating or enqueuing a session. */
export declare function listBackgroundTasks(sessionId: string): Promise<BackgroundTaskSnapshot[]>;
export declare function getBackgroundTask(sessionId: string, taskId: string): Promise<BackgroundTaskSnapshot | undefined>;
export declare function cancelTask(sessionId: string, taskId: string): Promise<CancelBackgroundTaskOutcome>;
/**
 * Register a listener. Registration does not activate the session, and
 * passivation does not drop it. drain() waits for callbacks already queued;
 * closed reports callback failure or overflow so a host can stop a partial turn.
 *
 * Delivery is per-listener FIFO and never backpressures the run: a listener
 * whose queue exceeds the high-water mark is evicted — recover by
 * re-subscribing and catching up from the session store.
 */
export declare function subscribe(sessionId: string, listener: (event: FormattedSessionEvent) => void | Promise<void>): SessionSubscription;
export declare function subscribe<F extends SessionOutputFormat>(sessionId: string, listener: (event: FormattedSessionEvent<F>) => void | Promise<void>, options: SubscribeOptions<F>): SessionSubscription;
/**
 * Passivation hint. Optional, and never a terminal state: closing equals an
 * orderly crash, which ends the session's subagents and background tasks as
 * a CLI process exit does, and any verb reactivates the session from storage.
 */
export declare function close(sessionId: string): Promise<void>;
/**
 * Rewind a passivated session's durable branch. Call close() first to join all
 * foreground/background work. Later queries wait for this storage commit.
 * Does not emit a query lifecycle or discard existing subscriptions.
 */
export declare function rewind(sessionId: string, options: RewindOptions): Promise<RewindResult>;
export {};
