/**
 * Teammate Idle Tracker
 * =====================
 *
 * Per-teammate fine-grained idle state tracking, aligned with Claude Code's
 * `TaskState.isIdle` + `onIdleCallbacks[]` semantics (CC `src/utils/teammate.ts`
 * and `src/tasks/InProcessTeammateTask/types.ts`).
 *
 * Why this exists
 * ---------------
 * cbc already has two idle signals:
 *
 *   1. `TeammateIdle` hook (agent-task.ts:1015) — fires on every `agent_end`
 *      transition of a teammate. Coarse-grained, every turn end, no concept
 *      of "still has pending work in the queue".
 *   2. `TeamInboxDispatchService` — subscribes `agentStateSubject` 'agent_end'
 *      and activates the rich queue. Also coarse-grained.
 *
 * Neither supports:
 *
 *   - Blocking wait ("resolve when teammate becomes idle, else timeout").
 *   - Callback registration ("run this when they next become idle").
 *   - Query ("is X currently idle? who is working?").
 *
 * The `TeammateIdleTracker` is a tiny per-process singleton that supplies all
 * three. It is read-only for the dispatch path — dispatch stays the authority
 * on *what* to do on agent_end; the tracker just reports *state*.
 *
 * Lifetime & scope
 * ----------------
 * - In-process teammates only (the default backend; detached/tmux only kicks in
 *   when CODEBUDDY_DISABLE_INPROCESS_TEAMMATES=1 or --swarm is set). Detached-
 *   process teammates have their own idle inference via the inbox poller (not
 *   yet wired); `register()` can be called for them but `markAgentEnd` will
 *   never fire, so they stay `isIdle=false` until `unregister`.
 * - State key is `${teamName}::${teammateName}`. Two teams with the same
 *   teammate name stay isolated.
 * - Callbacks fire via `queueMicrotask` to avoid re-entrancy when the callback
 *   wants to register/unregister during fire.
 *
 * env
 * ---
 * - `CODEBUDDY_TEAM_IDLE_DETECTION_DISABLED=1` — all register/markAgentEnd/
 *   markBusy become no-ops; `waitForIdle` resolves `true` immediately;
 *   `onIdle` fires the callback on the next microtask.
 */
export declare const TeammateIdleTracker: unique symbol;
/**
 * Snapshot of tool/token activity since a teammate was registered.
 *
 * Aligned with CC's `TaskState.progress` (see
 * `claude-code-tanbiralam/src/tasks/LocalMainSessionTask.ts:456-462`) —
 * read-mostly state that UI layers can poll to render "X tokens emitted,
 * Y tool calls, currently using Bash" style live indicators without
 * subscribing to every stream event themselves.
 *
 * Token counts use a rough heuristic (1 token ≈ 4 chars) and are NOT
 * guaranteed to match the provider's billed token count. They are for
 * relative progress display only.
 */
export interface TeammateProgressSnapshot {
    /** Number of tool_use blocks observed since register. */
    readonly toolUseCount: number;
    /**
     * Rough cumulative token estimate over assistant text blocks emitted
     * since register. Not a billing number.
     */
    readonly tokenCount: number;
    /**
     * Recent tool activity (bounded ring). The most recent activity is
     * the last entry. Shape matches CC's `ToolActivity`: just tool name
     * + coarse input for UI display.
     */
    readonly recentActivities: readonly TeammateToolActivity[];
}
export interface TeammateToolActivity {
    readonly toolName: string;
    /** Input arguments as-provided (may be large; UI should truncate). */
    readonly input?: unknown;
    /** ms timestamp when the activity was recorded. */
    readonly at: number;
}
/** Max number of recent activities retained in the ring buffer. */
export declare const TEAMMATE_MAX_RECENT_ACTIVITIES = 10;
/**
 * Read-only snapshot of a teammate's idle state.
 *
 * Note: consumers should not rely on object identity across calls; each
 * `getState` call returns a fresh snapshot.
 */
export interface TeammateState {
    readonly teamName: string;
    readonly teammateName: string;
    /**
     * True = last agent_end observed AND no dispatchable items in the rich
     * queue at that moment. Cleared to `false` on `markBusy`.
     */
    readonly isIdle: boolean;
    /** Last agent_end ms timestamp; 0 if never observed. */
    readonly lastEndedAt: number;
    /** Last markBusy ms timestamp; 0 if never busy. */
    readonly lastBusyAt: number;
    /**
     * Whether the teammate process is still considered alive. Set to `false`
     * on `unregister` (destroy / forceKill path).
     */
    readonly alive: boolean;
    /**
     * The request_id of a pending plan approval request that blocks this
     * teammate. Populated by Block B (ExitPlanModeTool teammate branch) and
     * cleared when the matching response arrives. Consumed by Block C
     * (ShutdownCoordinator) to warn when forcing shutdown of a teammate that
     * is mid-approval.
     */
    readonly awaitingApprovalRequestId?: string;
    /**
     * Cumulative tool/token progress since register (never resets across
     * turns). Populated by the agent-task combineSubject subscription via
     * `recordActivity` / `recordTokens`.
     */
    readonly progress: TeammateProgressSnapshot;
}
export interface WaitForIdleOptions {
    /**
     * Max ms to wait. `undefined` / `0` = wait forever.
     * If the teammate is already idle when called, resolves `true` on the
     * next microtask (not synchronously — mirrors CC semantics so callers
     * never observe interleaving).
     */
    timeoutMs?: number;
    /**
     * Optional abort — if the signal aborts, resolves `false` (NOT rejects).
     * Convention matches other cbc `waitFor*` helpers.
     */
    signal?: AbortSignal;
}
export interface TeammateIdleTracker {
    /**
     * Mark a teammate as tracked. Called immediately after spawn.
     * Idempotent — calling twice is a no-op. Initial state: `alive=true`,
     * `isIdle=false`.
     */
    register(teamName: string, teammateName: string): void;
    /**
     * Stop tracking a teammate. Called on destroy / forceKill. Fires all
     * pending `onIdle` callbacks and `waitForIdle` waiters with the final
     * state (`alive=false`, still `isIdle=false` typically).
     *
     * Subsequent `markAgentEnd` / `markBusy` / `setAwaitingApproval` calls
     * for this teammate are silently ignored.
     */
    unregister(teamName: string, teammateName: string): void;
    /**
     * Called from the agent-task subscription on `agent_end`. The tracker
     * reads `RichMessageQueueManager.getQueue(sessionId)`:
     *   - any `immediateItemId` / `pending` / `sending` item → stay busy
     *     (isIdle=false)
     *   - otherwise                                         → flip isIdle to
     *     true and fire pending callbacks/waiters.
     *
     * Idempotent: if already `isIdle=true`, updates `lastEndedAt` but does
     * not re-fire callbacks.
     */
    markAgentEnd(teamName: string, teammateName: string, sessionId: string): void;
    /**
     * Explicitly mark the teammate as busy. Called by
     * `TeamInboxDispatchService` right before `activate()` so the tracker
     * stays consistent with the dispatch flow.
     *
     * Does not schedule anything; only state transition + timestamp update.
     */
    markBusy(teamName: string, teammateName: string, sessionId: string): void;
    /** Query current state snapshot. `undefined` if not registered. */
    getState(teamName: string, teammateName: string): TeammateState | undefined;
    /**
     * Enumerate all live teammates in a team (alive=true). Includes idle
     * and busy. Used by Block C's `shutdownAll`.
     */
    getAllInTeam(teamName: string): TeammateState[];
    /**
     * Return names of teammates currently NOT idle. Empty array = all idle.
     * Equivalent to CC's `hasWorkingInProcessTeammates` semantic.
     */
    getWorkingTeammates(teamName: string): string[];
    /**
     * Resolve when the teammate becomes idle, `alive` flips to false, the
     * signal aborts, or the timeout elapses. Never rejects.
     *
     * Return value:
     *   - `true`  = teammate reached isIdle=true
     *   - `false` = timeout / aborted / teammate no longer alive
     *   - `true`  (fast path) if already isIdle at call time
     */
    waitForIdle(teamName: string, teammateName: string, opts?: WaitForIdleOptions): Promise<boolean>;
    /**
     * Resolve when every alive teammate in the team becomes idle.
     * Aligned with CC `waitForTeammatesToBecomeIdle(teamName)`.
     */
    waitAllIdle(teamName: string, opts?: WaitForIdleOptions): Promise<boolean>;
    /**
     * Register a one-shot idle callback. If the teammate is already idle,
     * the callback is scheduled on the next microtask. Otherwise it fires on
     * the next `markAgentEnd` that flips state to idle, or on `unregister`.
     *
     * Returns an unsubscribe function.
     */
    onIdle(teamName: string, teammateName: string, cb: () => void): () => void;
    /**
     * Record that the teammate is waiting on a plan approval response.
     * Called from Block B when the ExitPlanMode teammate branch sends
     * `plan_approval_request`, cleared when the matching response arrives
     * or the teammate is unregistered.
     */
    setAwaitingApproval(teamName: string, teammateName: string, requestId: string | undefined): void;
    /**
     * Record a tool_use activity observed from the teammate's session
     * stream. Increments `progress.toolUseCount`, pushes a
     * {@link TeammateToolActivity} to the ring buffer (capped at
     * {@link TEAMMATE_MAX_RECENT_ACTIVITIES}).
     *
     * No-op if the teammate is not registered / not alive / env-disabled.
     *
     * @param toolName Tool name (e.g. `Bash`, `Edit`).
     * @param input Arguments passed to the tool; stored as-is. Callers
     *              should not pass huge objects here — UI will truncate.
     */
    recordActivity(teamName: string, teammateName: string, toolName: string, input?: unknown): void;
    /**
     * Record a rough token delta from an assistant text block. Callers
     * estimate token count themselves (e.g. `Math.ceil(text.length / 4)`)
     * since the tracker doesn't know the tokenizer.
     *
     * No-op if the teammate is not registered / not alive / env-disabled.
     */
    recordTokens(teamName: string, teammateName: string, tokenDelta: number): void;
}
/** env helper — exported for tests. */
export declare function isTeammateIdleDetectionDisabled(): boolean;
