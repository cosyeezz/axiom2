import { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentTask } from '../agent-task';
import type { ITeammateBackend } from './backends/teammate-backend-protocol';
import { TeamMemberInfo } from './team-protocol';
/**
 * Last-known failure for a teammate's AgentTask (Issue 5).
 *
 * Populated by `AgentTask.execute()`'s failed branch (non-silentAbort path);
 * consumed by:
 *   - `TeammateFailureInterceptor` — to inject `<teammate-failures>` into the
 *     team-lead's next system prompt so the main agent surfaces the failure
 *     to the user instead of fabricating an answer.
 *   - `AcpTeamBridge.collectMemberStatuses` — to forward the reason to the
 *     Desktop UI for red-icon + tooltip rendering.
 *
 * `error` is already sanitized (credentials / URL query strings stripped and
 * truncated to <=500 chars) by `sanitizeErrorForPrompt` at write time.
 * `category` is a coarse hint produced by `categorizeFailure`.
 */
export interface TeammateFailureInfo {
    /** Sanitized, truncated error message. Safe for UI & prompt embedding. */
    error: string;
    /** Epoch milliseconds at which the failure was recorded. */
    occurredAt: number;
    /** Coarse classification: auth / network / model / unknown. */
    category: 'auth' | 'network' | 'model' | 'unknown';
}
export type TeamMemberLifecycle = 'alive' | 'terminated';
export type TeamMemberActivity = 'starting' | 'working' | 'idle' | 'paused';
export type TeamMemberPauseReason = 'lead-cancelled';
export type TeamMemberRegistryStateChangeListener = (teamNames: readonly string[]) => void;
export interface TeamMemberSnapshot {
    lifecycle: TeamMemberLifecycle;
    activity: TeamMemberActivity;
    pauseReason?: TeamMemberPauseReason;
}
/**
 * Teammate state as reported outward: stable identity, the disposable
 * AgentTask's status, and the logical actor state that outlives it.
 */
export interface TeamMemberStatusFields {
    name: string;
    agentType: string;
    color?: string;
    description?: string;
    status: string;
    lifecycle?: TeamMemberLifecycle;
    activity?: TeamMemberActivity;
    taskId?: string;
    sessionId?: string;
    /** Agent tool call in the parent that created this member. */
    parentToolCallId?: string;
}
/** Shared by the ACP member_status_change push and session replay. */
export declare function toTeamMemberStatusFields(member: TeamMember): TeamMemberStatusFields;
export interface TeamMemberKickOptions {
    /**
     * Live capability owned by one trusted human lead turn. The callback is
     * deliberately re-evaluated after every await before a paused actor may
     * cross the backend resume boundary.
     */
    leadCancelledResumeLease?: () => boolean;
}
export type TeamMemberKickResult = 'empty' | 'delivered' | 'resumed' | 'deferred' | 'terminated';
export interface TeamMemberAdoptRuntimeOptions {
    mainSession: Session;
    taskId: string;
    prompt: string;
    agentType: string;
    model?: string;
    permissionMode?: string;
    maxTurns?: number;
    memberIndex?: number;
    taskDescription?: string;
    paused?: boolean;
}
/**
 * TeamMember encapsulates a single teammate's lifecycle.
 *
 * Under the hood, each teammate is spawned via a TeammateBackend (default:
 * in-process AgentTask; see teammate-backend-registry.ts autoDetect for fallback
 * to detached/tmux when CODEBUDDY_DISABLE_INPROCESS_TEAMMATES=1 or --swarm).
 * It polls the mailbox for new messages and injects them into the
 * teammate's session as user-type messages wrapped in <teammate-message>.
 *
 * This class is NOT a CellJS component — it is created dynamically per teammate
 * by the TeamCreate tool.
 */
export declare class TeamMember {
    /** The underlying AgentTask for this teammate (in-process mode only) */
    private agentTask;
    /** Stop function for mailbox polling */
    private stopPoller?;
    /** Member info from TeamConfig */
    readonly info: TeamMemberInfo;
    /** Team name */
    readonly teamName: string;
    /**
     * Most recent failure observed on this teammate's AgentTask (Issue 5).
     * Undefined when the teammate has not failed, or has been respawned
     * after a prior failure (see `spawn()` / `respawn()` which clear it).
     */
    lastFailure?: TeammateFailureInfo;
    private readonly logger;
    private readonly teamMailbox;
    private readonly messageQueueManager;
    private readonly stateMachine;
    /** Backend that spawned this teammate */
    private backend?;
    /** Backend-assigned ID (taskId for in-process, PID for detached, paneId for tmux) */
    private backendId?;
    /** Local force-kill marker for detached/tmux teammates without AgentTask status. */
    private killedWithoutTask;
    /** Saved actor config. A fresh physical AgentTask is created for each turn. */
    private spawnConfig?;
    /** Lead `teamCancelEpoch` seen when this member was dispatched; restored members leave it unset. */
    private dispatchCancelEpoch?;
    /** First AgentTask ID (= original session storeId / persistence filename).
     *  Set once on initial spawn and NEVER updated. All respawns resume from
     *  this same storeId so history accumulates in a single .jsonl file. */
    private originalTaskId?;
    /** Guard to prevent concurrent respawn attempts */
    private isRespawning;
    /** Guard to prevent concurrent wake-ups when agent is idle */
    private isWaking;
    /** Long-lived logical actor state; independent from one AgentTask.status. */
    private lifecycle;
    private activity;
    private pauseReason?;
    /** The listener is rebound for every disposable AgentTask turn. */
    private taskStatusListener?;
    /** Single-flight backend transitions. */
    private stopPromise?;
    private resumePromise?;
    private resumeAttempt?;
    private permanentTerminationCommit?;
    private permanentTerminationSettlement?;
    private stopRequested;
    constructor(teamName: string, info: TeamMemberInfo);
    /**
     * Rebuild the logical teammate wrapper from durable team runtime metadata.
     * No physical AgentTask is created here; the next mailbox kick resumes the
     * original transcript through InProcessTeammateBackend.resume().
     */
    adoptInProcessRuntime(options: TeamMemberAdoptRuntimeOptions): void;
    /**
     * Spawn the teammate: create AgentTask, register it, start execution, and begin polling.
     *
     * @param mainSession Lead's session (parent)
     * @param prompt Initial prompt for the teammate
     * @param subagentType Agent type (e.g. "general-purpose")
     * @param options Optional spawn configuration
     */
    spawn(mainSession: Session, prompt: string, subagentType: string, options?: {
        model?: string;
        memberIndex?: number;
        maxTurns?: number;
        permissionMode?: string;
        /** 显式主模式（缺省从 leader 站立键 / 进程 --agent 解析）。 */
        agent?: string;
        taskDescription?: string;
        /** Agent tool call in the direct parent that created this member. */
        parentToolUseId?: string;
        /**
         * Lead `teamCancelEpoch` captured when the Agent call was dispatched
         * (defaults to the value at spawn entry). Only a cancel after this
         * point pauses the new member.
         */
        leadCancelEpoch?: number;
        /**
         * When true, use the raw prompt without wrapping in <teammate-message>.
         * Used for auto-team background tasks that are autonomous (not responding
         * to a team-lead instruction).
         */
        skipPromptWrapping?: boolean;
        /** Backend to use for spawning. Defaults to InProcessTeammateBackend. */
        backend?: ITeammateBackend;
        /** Leader HTTP endpoint for Permission Bridge (detached-process/tmux). */
        leaderEndpoint?: string;
    }): Promise<void>;
    private disposePhysicalTask;
    /**
     * Start the next disposable turn through the concrete in-process backend.
     * The logical member and original transcript identity stay stable while
     * backendId and AgentTask ownership are replaced atomically on commitment.
     */
    private resumeWithPrompt;
    getSnapshot(): TeamMemberSnapshot;
    private toRuntimeMemberStatus;
    private writeRuntimeMember;
    private writeRuntimeMemberStatus;
    private persistRuntimeMemberStatus;
    private writeRuntimeMemberTermination;
    /** Logical actor liveness, independent from the current AgentTask turn. */
    isAlive(): boolean;
    /** True while a physical turn is being allocated or executing. */
    isWorking(): boolean;
    isPaused(): boolean;
    private getInProcessBackend;
    private hasValidLeadResumeLease;
    private isLeadCancelBarrierActive;
    private isLeadCancelledSinceDispatch;
    /**
     * Project the logical actor activity onto the legacy idle tracker. Formal
     * in-process AgentTasks use `detached: true` for output routing, so the
     * task-level `!isDetached` hook never observes their end. TeamMember is the
     * authoritative owner of this transition.
     */
    private syncIdleTracker;
    private bindAgentTask;
    private applyTaskStatus;
    /**
     * Get the underlying AgentTask
     */
    getAgentTask(): AgentTask;
    /**
     * Set the agent task (used for implicit team members created by background agents)
     */
    setAgentTask(task: AgentTask): void;
    /**
     * Get the task ID (used for referencing this teammate)
     */
    getTaskId(): string;
    /**
     * The lead session id that spawned this teammate.
     * Used to attribute an active teammate to its leader when the leader's
     * own state machine is idle but members are still streaming (#94691).
     */
    getParentSessionId(): string | undefined;
    /**
     * Check if the teammate is still running
     */
    isActive(): boolean;
    /**
     * Check if the teammate has finished (completed/failed/cancelled/killed)
     */
    isFinished(): boolean;
    /**
     * Async alive check — accurate for all backend types.
     */
    isAliveAsync(): Promise<boolean>;
    /**
     * Send a message to this teammate by writing to their inbox.
     * The poller will pick it up and inject it into their session.
     */
    sendMessage(from: string, content: string, summary: string, color?: string): Promise<void>;
    /**
     * Request graceful shutdown.
     * Sends a shutdown_request message and waits for the teammate to respond.
     *
     * Back-compat: no fail-safe timeout (matches CC behavior).
     * For fail-safe timeout, use {@link shutdownGracefully}.
     */
    requestShutdown(): Promise<void>;
    /**
     * Graceful shutdown with fail-safe timeout (Block C — CC alignment).
     *
     * Delegates to `ShutdownCoordinator`:
     *   1. (optional) wait for idle
     *   2. send shutdown_request with a routable requestId
     *   3. wait for shutdown_response OR timeout
     *   4. on timeout: forceKill
     *
     * @param opts timeoutMs default = CODEBUDDY_TEAM_SHUTDOWN_GRACEFUL_TIMEOUT_MS (15000).
     *             `timeoutMs=0` disables fail-safe (pure wait forever).
     * @returns `'approved' | 'rejected' | 'timeout' | 'forced' | 'not-alive'`.
     */
    shutdownGracefully(opts?: {
        reason?: string;
        timeoutMs?: number;
        waitForIdleFirst?: boolean;
    }): Promise<'approved' | 'rejected' | 'timeout' | 'forced' | 'not-alive'>;
    /**
     * WorkBuddy ACP soft stop. It ends only the current in-process turn and
     * leaves the logical teammate registered as paused. Its mailbox poller is
     * stopped so peer traffic and broadcasts can accumulate without reviving
     * the actor.
     */
    stopCurrentTurn(reason: TeamMemberPauseReason): Promise<void>;
    /**
     * Explicitly consume the current unread snapshot. A paused member can only
     * cross this boundary when the caller supplies a still-live capability for
     * the exact human lead turn. Callback failure leaves the inbox unread.
     */
    kick(options?: TeamMemberKickOptions): Promise<TeamMemberKickResult>;
    /**
     * Runs before the physical task settles. The in-memory barrier is
     * synchronous; the returned promise represents the durable runtime
     * tombstone. Concurrent callers share the same commit.
     */
    commitPermanentTermination(): Promise<void>;
    private killPhysicalTurn;
    /** Physical unwind of a logically terminated actor. Concurrent callers share it. */
    private settlePermanentTermination;
    /**
     * Force kill the teammate task.
     *
     * @param opts.keepWakeable
     *   - true (默认): 仅杀 backend 进程让当前 task cancelled,**保留 mailbox polling**
     *     让后续 SendMessage 写 inbox 时 handleIncomingMessages 检测 isFinished
     *     走 respawn 路径自动重起 member。适合"用户中途取消但希望后续能继续"场景
     *     (interrupt-handler / TUI ESC)。
     *   - false: 完全永久关闭,同时停 mailbox polling。适合 shutdown_response
     *     approve 后 + destroy() 路径。
     *
     * 修复参考 bug_team_member_cancel_no_revive.md(2026-05-07):
     * 用户中途取消 team member 后 forceKill 同时 stopMailboxPolling 让 inbox
     * 永远没人拉,SendMessage 写进去也唤不醒。改为默认保留 polling 让 respawn
     * 路径(team-member.ts:524)能在新消息到达时自动恢复 member。
     */
    forceKill(opts?: {
        keepWakeable?: boolean;
    }): Promise<void>;
    /**
     * Stop and clean up this teammate.
     * - Stops mailbox polling
     * - Kills the AgentTask
     * - Removes from TeamManager config (if still in a team)
     * - Removes from global TeamMemberRegistry
     */
    destroy(): Promise<void>;
    private startMailboxPolling;
    private stopMailboxPolling;
    /**
     * #82046：消费 lead 回来的 `plan_approval_response`，把批准结果落到**权限模式状态**上。
     *
     * 为什么必须在这里做，而不是让模型自己"读懂后自觉"：
     * teammate 以 `mode='plan'` 派生时被硬锁在 Plan 模式（`agent-task.ts`
     * configurePermissionMode 的 Priority 1 + `subAgentPlanModeLocked` 标记），
     * 系统层面会拦住写操作。lead 批准之后如果不解锁，teammate 拿到的只是一句
     * "已批准"的文本，真要动手仍会被权限模式挡住（或者反过来，模型无视驳回继续动手
     * 也没人拦）。审批结果必须变成状态，而不是停留在措辞上。
     *
     * 解锁必须同时改三处，否则会被 respawn 打回去：
     *   1. `spawnConfig.permissionMode` —— respawn 会用它重建 AgentTask（见 respawn()
     *      的解构），不清掉的话下一轮又被锁回 Plan；
     *   2. 活跃子会话的 `subAgentPlanModeLocked` meta —— ExitPlanMode 的可见性门
     *      （`isExitPlanModeVisibleForSession`）读它；
     *   3. 活跃子会话的 `permissionModeSubject` —— 真正生效的权限判据。
     *
     * 驳回（approve=false）**不动**任何状态：teammate 留在 Plan 模式继续规划，
     * lead 的 feedback 会随消息文本进入模型上下文（与主session 的「调整计划」同构）。
     *
     *幂等/ 容错：解析失败的消息一律跳过（当普通文本）；子会话尚未就绪时只清
     * spawnConfig + 记日志，respawn 后自然按新模式起来。
     */
    private applyPlanApprovalResponses;
    /**
     * Format a message for injection into the teammate's session.
     * Messages from 'user' are injected as plain user messages (no XML wrapping).
     * Messages from other teammates are wrapped in <teammate-message> XML.
     */
    private formatMessageForInjection;
    private isShutdownRequest;
    private autoApproveShutdown;
    private acknowledgeShutdownRows;
    private acceptShutdownRequests;
    /**
     * The shutdown_response just written to the lead inbox already wakes the
     * lead and tells it this teammate is done; a delayed success notice from
     * the same teammate would only wake the lead once more. A failure notice
     * is the regular failure report and is never suppressed here.
     */
    private cancelPendingCompletionNotice;
    /**
     * A closed task session can still be publishing its terminal status
     * (SubagentStop hooks, final output). Approving a shutdown inside that
     * window lets kill() stamp `killed` over the pending `completed`, so wait
     * for the same settlement barrier resume uses (#118790).
     */
    private waitForTaskSettlement;
    /**
     * Handle new messages from the mailbox.
     * Messages from 'user' are injected as plain user messages.
     * Messages from teammates are wrapped in <teammate-message> XML.
     *
     * If the teammate has finished (task completed/failed), it will be
     * automatically respawned with the new message as the prompt.
     *
     * Returns a promise the mailbox poller awaits — failures here keep the
     * messages unread for retry on the next poll. See team-mailbox.ts
     * `startPolling` for the contract and the 2026-05-22 bug history that
     * motivated awaiting the callback.
     */
    private handleIncomingMessages;
}
/**
 * Registry for tracking active TeamMember instances.
 * Lives in-memory only; not a CellJS component since it's managed by TeamManager lifecycle.
 */
export declare class TeamMemberRegistry {
    private members;
    private stateChangeListeners;
    private keyOf;
    register(member: TeamMember): void;
    /**
     * Look up a member by (name, teamName). Both are required — cross-team
     * name reuse is allowed, so a bare name is not a unique identity.
     * For diagnostic lookups across teams use `findByName` instead.
     */
    get(name: string, teamName: string): TeamMember | undefined;
    /**
     * Diagnostic-only: return the first member with the given name regardless
     * of team. Must NOT be used by conflict checks or mailbox routing — those
     * depend on (name, teamName) identity.
     */
    findByName(name: string): TeamMember | undefined;
    getAll(): TeamMember[];
    getActive(): TeamMember[];
    remove(name: string, teamName: string): void;
    destroyAll(): Promise<void>;
    onStateChange(listener: TeamMemberRegistryStateChangeListener): void;
    offStateChange(listener: TeamMemberRegistryStateChangeListener): void;
    notifyStateChange(teamNames: readonly string[]): void;
    get size(): number;
}
