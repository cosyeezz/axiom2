import type { TeamMember } from './team-member';
/**
 * Shutdown Coordinator
 * ====================
 *
 * Block C of the "align CC Agent Teams three gaps" MR.
 *
 * Leader-side orchestration for graceful teammate shutdown with a
 * fail-safe force-kill. CC sends `shutdown_request` via mailbox and
 * *waits indefinitely* — if the teammate model never responds (hung,
 * crashed mid-turn, ignored the request), the pending request leaks.
 * cbc closes that gap by adding a timeout that force-kills the teammate
 * if no `shutdown_response` arrives within
 * `CODEBUDDY_TEAM_SHUTDOWN_GRACEFUL_TIMEOUT_MS` (default 15s).
 *
 * Public shape:
 *
 *   const coord = ContainerUtil.get<ShutdownCoordinator>(ShutdownCoordinator);
 *   const outcome = await coord.shutdown(member, { reason, timeoutMs });
 *   // outcome: 'approved' | 'rejected' | 'timeout' | 'forced' | 'not-alive'
 *
 * `fulfillResponse(requestId, approved, reason?)` is invoked from the
 * SendMessageTool's `handleShutdownResponse` path when a teammate replies
 * — it matches the requestId into the pending map and resolves.
 *
 * Integration with Block A:
 *   - Optional `waitForIdleFirst: true` — the coordinator waits up to a
 *     third of `timeoutMs` for the teammate to become idle before
 *     sending shutdown_request. Gives well-behaved teammates a chance
 *     to finish the current turn cleanly.
 *
 * env:
 *   - `CODEBUDDY_TEAM_SHUTDOWN_GRACEFUL_TIMEOUT_MS=15000` (default)
 *   - Set to `0` to disable fail-safe forceKill (CC parity — wait forever)
 */
export declare const ShutdownCoordinator: unique symbol;
export type ShutdownOutcome = 'approved' | 'rejected' | 'timeout' | 'forced' | 'not-alive';
export interface ShutdownOptions {
    /** Short reason string forwarded into the shutdown_request payload. */
    reason?: string;
    /**
     * Wall-clock ms budget. `undefined` → read env default. `0` → disable
     * fail-safe (wait indefinitely, resolve 'timeout' only if cancelAll
     * fires).
     */
    timeoutMs?: number;
    /**
     * If true, coord.shutdown() first awaits `tracker.waitForIdle(..., timeoutMs/3)`
     * so the teammate can drain the current turn. Relevant only if Block A
     * tracker is enabled (otherwise no-op and continues immediately).
     */
    waitForIdleFirst?: boolean;
}
export interface ShutdownCoordinator {
    /**
     * Orchestrated shutdown for a single teammate. Never throws; always
     * resolves an outcome string.
     */
    shutdown(member: TeamMember, opts?: ShutdownOptions): Promise<ShutdownOutcome>;
    /**
     * Called from `SendMessageTool.handleShutdownResponse` when a teammate
     * writes a shutdown_response to the leader mailbox. Looks up the
     * requestId and resolves the pending promise.
     *
     * Returns `true` if the requestId matched a pending shutdown, `false`
     * if no match. Callers (e.g. the lead-inbox poller) use this to decide
     * whether the response was an "internal" coordinator-driven shutdown
     * (match → silently consume) or a "tool-driven" shutdown initiated by
     * the LLM lead via SendMessage(type=shutdown_request) (no match → the
     * lead has no pending promise to resolve, so the response should be
     * surfaced into the lead session as a teammate message instead of
     * being silently dropped).
     *
     * Unknown requestId → logged + return `false` (safe: the pending slot
     * may have timed out already, or the request was tool-initiated).
     */
    fulfillResponse(requestId: string, approved: boolean, reason?: string): boolean;
    /**
     * Cancel every pending shutdown request (e.g. leader exit / team
     * deletion). All pending promises resolve 'timeout' (NOT 'forced' —
     * caller is responsible for subsequent forceKill).
     */
    cancelAll(reason: string): void;
}
export declare function resolveShutdownTimeoutMs(): number;
export declare class ShutdownCoordinatorImpl implements ShutdownCoordinator {
    private readonly logger;
    private readonly pending;
    constructor();
    shutdown(member: TeamMember, opts?: ShutdownOptions): Promise<ShutdownOutcome>;
    fulfillResponse(requestId: string, approved: boolean, reason?: string): boolean;
    cancelAll(reason: string): void;
    private onTimeout;
    private resolvePending;
    private waitIdleBestEffort;
    private canReceiveShutdown;
    private newRequestId;
}
