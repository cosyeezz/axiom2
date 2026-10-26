import type { RunContext } from '../../../cbc-shared/node/index.js';
/** The trusted origin carried by a logical agent turn. */
export type AgentRunOrigin = 'human';
/** Explicitly continue the logical turn in the current async scope. */
export type AgentRunContinuation = 'current';
export interface AgentRunScopeOwner {
    session: object;
    agent: object;
}
export interface AgentRunPipelineOptions {
    continuation?: AgentRunContinuation;
    /** Exact SDK state being resumed (approval/interruption continuation). */
    sourceRun?: RunContext<unknown>;
}
export declare const AgentRunScope: unique symbol;
/**
 * Process-local authority for one logical agent turn.
 *
 * Ordinary nested runs always start isolated. Only an explicit `current`
 * continuation can claim a passive logical turn, and each physical run offers
 * that continuation exactly once.
 */
export interface AgentRunScope {
    runPipeline<T>(owner: AgentRunScopeOwner, options: AgentRunPipelineOptions | undefined, callback: () => T): T;
    activateHuman(owner: AgentRunScopeOwner): boolean;
    runPhysical<T>(owner: AgentRunScopeOwner, callback: () => T): T;
    /** Recover the logical turn that belonged to one exact SDK run. */
    captureRun<T>(runContext: RunContext<unknown> | undefined, owner: AgentRunScopeOwner, callback: () => T): T;
    bindRun(runContext: RunContext<unknown>, agent: object): void;
    getOrigin(runContext: RunContext<unknown> | undefined): AgentRunOrigin | undefined;
    /** End exact physical authority while retaining a passive logical scope. */
    revokeRun(runContext: RunContext<unknown> | undefined): void;
    /** Invalidate all logical and physical authority for one Session. */
    revokeSession(session: object): void;
}
export declare class AgentRunScopeImpl implements AgentRunScope {
    private readonly storage;
    private readonly activeLeaseByRun;
    private readonly bindingByRun;
    private readonly leasesBySession;
    runPipeline<T>(owner: AgentRunScopeOwner, options: AgentRunPipelineOptions | undefined, callback: () => T): T;
    activateHuman(owner: AgentRunScopeOwner): boolean;
    runPhysical<T>(owner: AgentRunScopeOwner, callback: () => T): T;
    captureRun<T>(runContext: RunContext<unknown> | undefined, owner: AgentRunScopeOwner, callback: () => T): T;
    bindRun(runContext: RunContext<unknown>, agent: object): void;
    getOrigin(runContext: RunContext<unknown> | undefined): AgentRunOrigin | undefined;
    revokeRun(runContext: RunContext<unknown> | undefined): void;
    revokeSession(session: object): void;
    private issueHumanTurn;
    private claimCurrent;
    private takePipelineLease;
    private resolveRunCapture;
    private claimRunSource;
    private canClaim;
    private markClaimed;
    private runState;
    private settleState;
    private sameOwner;
    /**
     * Manager run clones inherit the cached Agent's event channel with
     * `Object.create(cachedAgent)`. The lifecycle listener therefore reports
     * the cached Agent even though the SDK is dispatching its isolated clone.
     * Accept that exact one-hop prototype relationship, but reject unrelated
     * nested/handoff agents that merely share the ambient async scope.
     */
    private isLifecycleAgentForOwner;
    private invalidateSessionLeases;
    private isPromiseLike;
}
//# sourceMappingURL=agent-run-scope.d.ts.map