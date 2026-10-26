/**
 * After this many consecutive classifier *call failures* (model errors /
 * unavailability — NOT block verdicts), the failure breaker opens and the
 * service short-circuits the classifier + kicks the session out of auto. Kept
 * distinct from the denial-limit counters below (decision D3-A #1): one tracks a
 * flaky model, the other tracks the model deliberately blocking actions.
 *
 * Deliberately far above the denial limits: leaving auto mode is disruptive and
 * classifier call failures are usually transient, so the breaker should only
 * open for a model that is persistently broken — not for a short blip. Claude
 * Code never leaves auto on classifier failures at all (its own session-level
 * auto breaker fires when the *server* rejects auto mode outright), so a low
 * threshold here drops users out of auto far more eagerly than Claude does.
 */
export declare const AUTO_MODE_CIRCUIT_BREAKER_THRESHOLD = 5;
/**
 * Classifier-BLOCK denial limits (Claude Code 2.1.181 `I_m`, research §11):
 *  - 3 consecutive blocks, OR 20 total blocks in a session → auto pauses.
 * Interactive sessions fall back to a prompt; headless runs abort. On exceed,
 * both counters reset so the session can resume after the pause (Claude resets).
 *
 * "Block" here means any outcome that blocked the action: a real block verdict,
 * or a classifier run that produced NO verdict (Claude bumps the same counters
 * for `parse_failure`). That way a classifier model which can never answer stops
 * blocking every action once the limit trips.
 */
export declare const AUTO_MODE_MAX_CONSECUTIVE_DENIALS = 3;
export declare const AUTO_MODE_MAX_TOTAL_DENIALS = 20;
/** Max number of recent denials kept per session for subsequent-approval dedup. */
export declare const AUTO_MODE_RECENT_DENIALS_MAX = 20;
/**
 * A single classifier denial, kept so a later approval of the SAME action
 * (toolName + inputKey) can be detected as a subsequent approval and the stale
 * record dropped (Claude `recordDenial` / `removeDenial`).
 */
export interface AutoModeDenialRecord {
    toolName: string;
    /** Human-readable label (`toolName <short projection>`), for views. */
    display: string;
    /** Dedup key — the classifier projection of the action (decision D3-A #2). */
    inputKey: string;
    reason: string;
    timestamp: number;
}
/**
 * Outcome of recording a classifier block, used by the host to decide whether to
 * keep denying or pause auto (Claude denial-limit handler).
 */
export interface AutoModeDenialLimitState {
    consecutiveDenials: number;
    totalDenials: number;
    /** True once consecutive ≥ 3 or total ≥ 20 — auto should pause this turn. */
    exceeded: boolean;
    /** Which threshold tripped, for the fallback message. */
    kind?: 'consecutive' | 'total';
}
export declare const AutoModeDenialTracker: unique symbol;
/**
 * Per-session auto-mode bookkeeping, aligned with Claude Code. Three independent
 * concerns (do not conflate — decision D3-A #1):
 *
 *  1. Recent denials — `toolName + inputKey + reason` of blocked actions, capped
 *     at 20. Used to detect when the user later approves the same action so the
 *     stale denial is dropped (subsequent approval). Pure record-keeping.
 *  2. Denial limit — counts classifier outcomes that BLOCKED the action (a block
 *     verdict, or a run that produced no verdict). `recordClassifierBlock`
 *     bumps consecutive + total and reports when 3-consecutive / 20-total trips;
 *     `resetConsecutiveDenials` is called on any allow.
 *  3. Failure breaker — counts CONSECUTIVE classifier CALL failures (errors /
 *     unavailability). After the threshold the breaker opens; a successful call
 *     resets it.
 *
 * Makes no permission decisions itself.
 */
export interface AutoModeDenialTracker {
    /** Record a classifier denial for the recent-denials / subsequent-approval view. */
    recordDenial(sessionId: string, record: AutoModeDenialRecord): void;
    /** Find a recent denial matching toolName + inputKey, if any. */
    findDenial(sessionId: string, toolName: string, inputKey: string): AutoModeDenialRecord | undefined;
    /** Drop a recent denial matching toolName + inputKey; returns true if one was removed. */
    removeDenial(sessionId: string, toolName: string, inputKey: string): boolean;
    /** Recent denials for a session, newest last. */
    getRecentDenials(sessionId: string): AutoModeDenialRecord[];
    /**
     * Record a classifier block: bumps consecutive + total. Returns the limit
     * state; when `exceeded`, both counters are reset to 0 so auto can resume
     * after the pause (Claude resets on exceed).
     */
    recordClassifierBlock(sessionId: string): AutoModeDenialLimitState;
    /** Reset the consecutive-denial counter (called on any allow). */
    resetConsecutiveDenials(sessionId: string): void;
    /** Record a classifier call failure; returns true if the breaker is now open. */
    recordClassifierFailure(sessionId: string): boolean;
    /** Record a successful classifier call; resets the consecutive-failure counter. */
    recordClassifierSuccess(sessionId: string): void;
    /** Whether the failure breaker is currently open (classifier should be short-circuited). */
    isCircuitOpen(sessionId: string): boolean;
    /** Drop all tracking for a finished session. */
    clear(sessionId: string): void;
}
export declare class AutoModeDenialTrackerImpl implements AutoModeDenialTracker {
    private readonly entries;
    private entry;
    recordDenial(sessionId: string, record: AutoModeDenialRecord): void;
    findDenial(sessionId: string, toolName: string, inputKey: string): AutoModeDenialRecord | undefined;
    removeDenial(sessionId: string, toolName: string, inputKey: string): boolean;
    getRecentDenials(sessionId: string): AutoModeDenialRecord[];
    recordClassifierBlock(sessionId: string): AutoModeDenialLimitState;
    resetConsecutiveDenials(sessionId: string): void;
    recordClassifierFailure(sessionId: string): boolean;
    recordClassifierSuccess(sessionId: string): void;
    isCircuitOpen(sessionId: string): boolean;
    clear(sessionId: string): void;
}
