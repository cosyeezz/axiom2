import type { Logger, W3CTraceContextMeta } from '@genie/telemetry';
import type { A2aClientService, A2aRegisteredAgent, A2aTaskSnapshot } from './a2a-protocol';
/**
 * Default bounded timeout for the best-effort user-cancel `tasks/cancel` RPC,
 * env-overridable via {@link ENV_A2A_CANCEL_TIMEOUT_MS}. Deliberately short
 * (issue #99451 follow-up, plan §3.4/§7): a user cancel should settle quickly
 * — a few seconds is far better than an undelivered cancel, but we don't want
 * the cancel path to hang on the full 120s client default.
 */
export declare const DEFAULT_A2A_CANCEL_TIMEOUT_MS = 3000;
/** Env override for the best-effort user-cancel timeout (ms). */
export declare const ENV_A2A_CANCEL_TIMEOUT_MS = "CODEBUDDY_A2A_CANCEL_TIMEOUT_MS";
/**
 * Bounded timeout for {@link cancelRemoteTaskForReport}'s RPCs, env-overridable
 * via {@link ENV_A2A_CANCEL_REPORT_TIMEOUT_MS}.
 *
 * Longer than {@link DEFAULT_A2A_CANCEL_TIMEOUT_MS} because this path must
 * REPORT the real outcome, not just fire and forget — 3s is too tight to
 * reliably read a slow remote's terminal state. Still far below the client's
 * own 120s default: the user is sitting in front of a card they just
 * dismissed, and both RPCs (cancel, plus the follow-up read when the task
 * turns out to be already terminal) are bounded by this, so the worst case
 * the user waits is twice this value rather than four minutes.
 */
export declare const DEFAULT_A2A_CANCEL_REPORT_TIMEOUT_MS = 10000;
/** Env override for {@link cancelRemoteTaskForReport}'s bounded timeout (ms). */
export declare const ENV_A2A_CANCEL_REPORT_TIMEOUT_MS = "CODEBUDDY_A2A_CANCEL_REPORT_TIMEOUT_MS";
/**
 * Best-effort remote `tasks/cancel` for a user-initiated cancel of an
 * in-flight outbound A2A poll (issue #99451 follow-up).
 *
 * When a user (not the model) cancels an `A2AGetTask` poll loop, the loop
 * simply throws and unwinds today, leaving the remote agent running an
 * orphaned task. This helper closes that gap by telling the remote agent to
 * stop the task it was polling.
 *
 * Two hard constraints (both plan traps):
 *
 * 1. **Never pass the session's already-aborted signal.** At user-cancel
 *    time `session.abortSignal` is already aborted, and
 *    `A2aClientServiceImpl.withAbortAndClient` aborts its own controller
 *    immediately if the passed signal is already aborted — firing ZERO
 *    network calls. So this deliberately passes NO `signal` and relies on the
 *    client's own bounded `timeoutMs`.
 * 2. **Swallow raced-completion errors.** A task that finished between the
 *    last poll and the cancel yields `TaskNotCancelable` / `TaskNotFound`; a
 *    cancel racing completion is a success, not an error to surface. Any
 *    failure is logged at debug and swallowed — this is invisible,
 *    best-effort cleanup with no user-facing error.
 */
export declare function bestEffortCancelRemoteTask(client: A2aClientService, agent: A2aRegisteredAgent, taskId: string, logger?: Pick<Logger, 'info' | 'debug'>, timeoutMs?: number, traceContext?: Readonly<W3CTraceContextMeta>): Promise<void>;
/**
 * Outcome of {@link cancelRemoteTaskForReport} — three distinguishable
 * results, because the caller has to tell the model which one happened.
 */
export type CancelForReportOutcome = 
/** `tasks/cancel` landed; `snapshot` is the resulting (canceled) task. */
{
    kind: 'canceled';
    snapshot: A2aTaskSnapshot;
}
/**
 * The task was ALREADY terminal, so it could not be canceled — per the
 * A2A spec that surfaces as `TaskNotCancelable`/`TaskNotFound`. `snapshot`
 * is a follow-up `tasks/get` carrying the task's REAL terminal state.
 */
 | {
    kind: 'already-terminal';
    snapshot: A2aTaskSnapshot;
}
/** Neither call settled (transport failure); the remote task's fate is unknown. */
 | {
    kind: 'unknown';
    message: string;
};
/**
 * Cancel a remote task and report what actually happened (issue #107183).
 *
 * Distinct from {@link bestEffortCancelRemoteTask}, and deliberately not a
 * variant of it. That helper exists for USER-ABORT cleanup: the session is
 * already tearing down, nobody is listening, so it returns `void`, passes no
 * signal (the session's is already aborted, which would fire zero network
 * calls), and swallows every failure into a debug log.
 *
 * This one runs on a LIVE session, when a user declined (or did not answer)
 * an approval card and the result has to be reported back to the model. Here
 * the failure modes are load-bearing information, not noise:
 *
 * - `TaskNotCancelable`/`TaskNotFound` means the task is already terminal —
 *   very often because the approval was granted through the approving
 *   system's own UI while our card was open, and the task ran to completion.
 *   Reporting "task canceled" there would tell the model the opposite of the
 *   truth, so we re-read the task and report its real state instead.
 * - A transport failure means we genuinely don't know, and the model must be
 *   told the remote task may still be running rather than assume either way.
 *
 * Never throws: every path resolves to one of the three
 * {@link CancelForReportOutcome} variants.
 *
 * `options.timeoutMs` defaults to {@link DEFAULT_A2A_CANCEL_REPORT_TIMEOUT_MS}
 * and is applied to BOTH RPCs. Defaulting here rather than at the call site is
 * deliberate: omitting it would fall through to `A2aClientServiceImpl`'s 120s
 * default, and with the follow-up read that is a four-minute stall right after
 * the user dismissed a card. The bound belongs to this helper's contract, so a
 * future caller cannot reintroduce that by forgetting to pass one.
 */
export declare function cancelRemoteTaskForReport(client: A2aClientService, agent: A2aRegisteredAgent, taskId: string, options?: {
    signal?: AbortSignal;
    traceContext?: Readonly<W3CTraceContextMeta>;
    timeoutMs?: number;
    logger?: Pick<Logger, 'info' | 'debug' | 'warn'>;
}): Promise<CancelForReportOutcome>;
