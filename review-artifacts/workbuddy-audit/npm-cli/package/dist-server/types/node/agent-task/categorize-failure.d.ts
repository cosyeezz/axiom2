/**
 * Pure helpers for classifying and sanitizing teammate sub-agent failures.
 *
 * Part of Issue 5 (teammate auth failure propagation):
 *   docs/workbuddy/fix/task-status-sync/issue-5-teammate-auth-failure.md
 *
 * `categorizeFailure` is used by AgentTask.execute()'s failed branch to tag
 * the failure with a coarse category; `sanitizeErrorForPrompt` strips out
 * credentials / URL query strings before the reason is forwarded to UI or
 * injected into the team-lead system prompt.
 *
 * Both functions are pure, synchronous, and have no runtime dependencies so
 * they are straightforward to unit-test.
 */
export type TeammateFailureCategory = 'auth' | 'network' | 'model' | 'unknown';
/**
 * Canonical error message used throughout `agent-task.ts` when the user
 * actively cancels a running sub-agent (e.g. pressing Esc / Ctrl+C, or the
 * UI sending an interrupt). Exported as a constant so producers and the
 * `isUserInterruption` predicate stay in sync — drift here would silently
 * regress the "interrupted ≠ failed" classification (Issue 5 follow-up).
 */
export declare const TASK_INTERRUPTED_BY_USER_MESSAGE = "Task was interrupted by user";
/**
 * Identify whether a thrown error represents a **user-initiated**
 * interruption (Esc / Ctrl+C / UI cancel) as opposed to a real sub-agent
 * failure.
 *
 * Used by `AgentTask.execute()`'s catch branch to route interruptions to
 * `cancelled` (a benign terminal state) instead of `failed`. A failed
 * teammate would otherwise get its `lastFailure` recorded on the team
 * registry and surface as a `<teammate-failures>` block on the team-lead's
 * next turn — even though the teammate is healthy and will resume on the
 * next message.
 *
 * Detection is exact-match on `Error.message` because every producer in
 * `agent-task.ts` constructs the error via
 * `new Error(TASK_INTERRUPTED_BY_USER_MESSAGE)` (see the 5 reject sites in
 * `waitForAgentCompletion`). String-based fallback handles the rare case
 * where the same sentinel reaches us as a plain string.
 */
export declare function isUserInterruption(error: unknown): boolean;
/**
 * Canonical error `name` for the sub-agent wall-clock timeout raised by
 * `AgentTaskImpl.executePhaseWithRetry` when the configured time budget is
 * exceeded. Exported so producers and {@link isSubagentWallClockTimeoutError}
 * stay in sync.
 *
 * Why a dedicated error instead of matching `errorMessage.includes('timed out after')`:
 * many unrelated timeouts in this repo reuse that phrasing (history queue, PAC RPC,
 * tool-level fetch …), so a substring match would misroute a real failure. Same
 * "type, not substring" precedent as `isMaxTurnsExceededError` /
 * `isUserInterruption`.
 */
export declare const SUBAGENT_WALL_CLOCK_TIMEOUT_ERROR_NAME = "SubagentWallClockTimeoutError";
/**
 * Error raised when a synchronous sub-agent exceeds its wall-clock budget.
 * Carries the budget that was actually armed so callers can report the real
 * duration instead of re-reading the (possibly drifted) env/config value.
 */
export declare class SubagentWallClockTimeoutError extends Error {
    /** The wall-clock budget that fired, in milliseconds. */
    readonly timeoutMs: number;
    constructor(timeoutMs: number, cause?: unknown);
}
/**
 * Identify whether a thrown error is the sub-agent wall-clock timeout.
 *
 * Matches on `instanceof` first, then falls back to the `name` field so a
 * dual-dist build resolving two copies of this module still classifies
 * correctly (cross-instance `instanceof` fails there — same fallback pattern
 * as `isMaxTurnsExceededError`).
 */
export declare function isSubagentWallClockTimeoutError(error: unknown): boolean;
/**
 * Classify a sub-agent failure into a coarse-grained category so the UI and
 * the team-lead prompt can adapt phrasing without needing to parse raw
 * model-provider errors.
 *
 * Detection is substring-based and case-insensitive; callers should treat
 * this as a best-effort hint rather than a contract.
 */
export declare function categorizeFailure(error: unknown): TeammateFailureCategory;
/**
 * Produce a version of the error message that is safe to embed into:
 *   - UI tooltips shown to the end user
 *   - `<teammate-failures>` system-reminder XML injected into team-lead prompts
 *
 * Responsibilities:
 *   1. Strip likely credentials (API keys, Bearer tokens, ?key=, etc.).
 *   2. Strip URL query strings entirely (they often carry auth / signatures).
 *   3. Collapse whitespace.
 *   4. Truncate to {@link ERROR_MESSAGE_MAX_LENGTH} characters.
 *
 * Never returns `undefined`. If the error is falsy, returns an empty string.
 */
export declare function sanitizeErrorForPrompt(error: unknown): string;
