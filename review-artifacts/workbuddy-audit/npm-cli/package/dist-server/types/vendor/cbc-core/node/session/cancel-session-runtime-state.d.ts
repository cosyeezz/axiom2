import { Logger } from '@genie/telemetry';
import type { InterruptionService, Session } from './session-protocol';
export interface CancelSessionBroadcast {
    broadcastToolCallFailedForSession(sessionId: string, reason: string, message: string): Promise<void>;
    broadcastCompactCancelled(sessionId: string): Promise<void>;
}
export interface CancelSessionTaskStorage {
    list(sessionId: string): Promise<Array<{
        id: string;
        status: string;
        metadata?: Record<string, unknown>;
    }>>;
    update(sessionId: string, id: string, update: {
        metadata: Record<string, unknown>;
    }): Promise<unknown>;
}
/**
 * Reason codes for cancel-session cleanup, aligned with the Desktop-side
 * `markPendingToolsAsFailed` reason vocabulary so that UI error cards /
 * telemetry can classify across both sides uniformly.
 *
 * See memory:
 *   - project_cli_cancel_cleanup_dimensions.md
 *   - project_tool_state_clear_before_idle.md (Desktop-side mirror)
 */
export type CancelSessionReason = 'cancelled' | 'session_teardown' | 'connection_lost' | 'plan_cancelled';
export interface CancelSessionRuntimeStateDeps {
    /** Required: interruption service for permission/question deferred cleanup. */
    interruptionService: InterruptionService;
    /**
     * Optional: ACP broadcast service for tool_call_update(status='failed') emission.
     * Absent in headless/SDK environments that don't attach an ACP agent; in that
     * case tool state cleanup falls back to whatever the session cleanup path
     * already does (combineSubject terminator / forwardingPromise cleanup).
     */
    acpBroadcastService?: CancelSessionBroadcast;
    /**
     * Optional: task storage service for marking in_progress todos as cancelled
     * via metadata. Todo status schema is locked to Claude Code parity
     * ('pending' | 'in_progress' | 'completed'), so cancelled state is
     * expressed through `metadata.cancelled` + `metadata.cancelReason` rather
     * than a new enum value.
     */
    taskStorage?: CancelSessionTaskStorage;
    /** Optional logger for telemetry/debug. */
    logger?: Logger;
}
/**
 * Orchestrates the full cleanup a session needs when a cancel signal arrives,
 * following the four-dimension consistency framework:
 *
 *   1. Interaction dimension  — reject pending permission/question deferreds
 *   2. Mode dimension         — restore permission mode out of Plan
 *   3. Todo dimension         — mark in_progress todos as cancelled (metadata)
 *   4. Tool dimension         — broadcast tool_call_update(status='failed')
 *   4.6 Queue dimension       — clear pending message queue (prevent drain-after-cancel);
 *                                snapshot retained on session.lastCancelledQueue
 *                                for telemetry/debug consumers
 *   5. Compact flag           — reset session.isCompressing (CLI-internal gate)
 *   6. Progress signal        — emit progressSubject.next(undefined) (UI banner clear)
 *
 * ORDER MATTERS:
 *
 * - Permission/question rejects come first so any code path blocked on
 *   `await deferred.promise` can start unwinding BEFORE the abort signal
 *   fires. This prevents the CLI from sitting in `handleToolApproval` /
 *   `AskUserQuestion.waitFor` while the session ostensibly reports IDLE.
 *
 * - `isCompressing` is reset LAST. `InterruptionService` uses
 *   `session.isCompressing === true` at abort time to branch between
 *   `SessionCompactionAbortError` (compact-internal silent abort) and the
 *   regular `SessionAbortedError` / rejection-run path. If we flipped the
 *   flag early, a user cancel during an in-flight compact would be
 *   misclassified as a normal cancel and race into the rejection run.
 *   Callers MUST invoke this orchestrator AFTER
 *   `session.abortController.abort()` has run so the branch decision has
 *   already been made.
 *
 * This function is intentionally synchronous for the steps that must settle
 * in one microtask (deferred rejects, subject writes) and fires
 * fire-and-forget for the async broadcast / disk write paths so that
 * upstream abort-handling code is never blocked on I/O.
 *
 * IDEMPOTENT: safe to call multiple times on the same session. Downstream
 * primitives (`cancelAllForSession`, `broadcastToolCallFailedForSession`)
 * are themselves idempotent.
 *
 * NOT for compact-internal silent abort: the compact flow uses
 * `silentAbort + fresh abortController` and must not trigger this
 * cleanup — it would wipe in-flight compact state. Only true user cancel
 * / teardown / connection loss should call this.
 */
export declare function cancelSessionRuntimeState(session: Session, reason: CancelSessionReason, deps: CancelSessionRuntimeStateDeps): void;
//# sourceMappingURL=cancel-session-runtime-state.d.ts.map