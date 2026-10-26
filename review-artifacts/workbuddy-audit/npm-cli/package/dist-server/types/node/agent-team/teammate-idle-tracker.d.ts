import { type TeammateIdleTracker, type TeammateState, type WaitForIdleOptions } from './teammate-idle-protocol';
/**
 * Implementation notes
 * --------------------
 * - Singleton per process. Map key: `${teamName}::${teammateName}`.
 * - All state transitions go through synchronous Map ops; callback fire is
 *   deferred via `queueMicrotask` so subscribers can register/unregister
 *   without re-entrancy hazards (CC teammate.ts:279 pattern).
 * - `markAgentEnd` reads the rich queue defensively — container lookup
 *   failures or missing queue are treated as "nothing pending" to avoid
 *   permanently blocking waiters on queue infra errors.
 * - The `isTeammateIdleDetectionDisabled()` flag bypasses all state
 *   transitions; `waitForIdle` resolves `true` on the next microtask and
 *   `onIdle` schedules the callback immediately. This lets Block C fall
 *   back to "no pre-wait, just send shutdown" behavior cleanly.
 */
export declare class TeammateIdleTrackerImpl implements TeammateIdleTracker {
    private loggerCache?;
    private readonly records;
    private readonly busySpans;
    /**
     * Logger is fetched lazily on first use (cached), never in the
     * constructor: a constructor-time ContainerUtil.get runs inside the
     * native layer's construction window (phase-1 纯建期) and drags the
     * celljs Logger→Product chain up pre-bridge — 竞态判例：该构造期容器触碰
     * 曾把 celljs agent/mcp 图预生在桥前世界，keep 单例快照旧实例导致
     * 会话级 MCP 工具面为空。Falls back to a no-op logger when the
     * container has no binding yet (test stubs).
     */
    private get logger();
    private keyOf;
    register(teamName: string, teammateName: string): void;
    unregister(teamName: string, teammateName: string): void;
    markAgentEnd(teamName: string, teammateName: string, sessionId: string): void;
    markBusy(teamName: string, teammateName: string, sessionId: string): void;
    getState(teamName: string, teammateName: string): TeammateState | undefined;
    getAllInTeam(teamName: string): TeammateState[];
    getWorkingTeammates(teamName: string): string[];
    waitForIdle(teamName: string, teammateName: string, opts?: WaitForIdleOptions): Promise<boolean>;
    waitAllIdle(teamName: string, opts?: WaitForIdleOptions): Promise<boolean>;
    onIdle(teamName: string, teammateName: string, cb: () => void): () => void;
    setAwaitingApproval(teamName: string, teammateName: string, requestId: string | undefined): void;
    private closeBusySpan;
    private toSnapshot;
    recordActivity(teamName: string, teammateName: string, toolName: string, input?: unknown): void;
    recordTokens(teamName: string, teammateName: string, tokenDelta: number): void;
}
