import { Application, ApplicationLifecycle, Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentTask, AgentTaskEvent, AgentTaskManager, AgentTaskStatus, TeamNotificationSettledListener } from './agent-task-protocol';
export declare const ENV_WAIT_FOR_RUNNING_TASKS_TIMEOUT_MS = "CODEBUDDY_CODE_WAIT_FOR_RUNNING_TASKS_TIMEOUT_MS";
export declare const DEFAULT_WAIT_FOR_RUNNING_TASKS_TIMEOUT_MS = 600000;
export declare const MAX_WAIT_FOR_RUNNING_TASKS_TIMEOUT_MS = 600000;
/** Clamp 0-600000 like TaskOutput. Default 600000. `0` means "no wait". */
export declare function resolveWaitForRunningTasksTimeoutMs(explicit?: number): number;
/** Dedup window: a member SendMessage newer than this is treated as "recent". */
export declare const FRAMEWORK_NOTIFICATION_DEDUP_WINDOW_MS = 30000;
/**
 * Decide whether a team member's framework completion-notification should be
 * delivered to the team-lead inbox, or deduped away.
 *
 * Pure function (no DI / no I/O) so the race-sensitive decision can be unit
 * tested directly — mirrors the `decidePausedQueueAction` pattern in
 * `team-inbox-dispatch-service.ts`.
 *
 * The dedup exists to avoid double-notifying when a member's own fresh
 * SendMessage is still the lead's most recent signal from that member. But it
 * must NOT apply to the *last* finishing member: that completion is the team's
 * "everyone is done, go aggregate" trigger. Suppressing it deadlocks the lead
 * at idle (UI stuck "thinking", no further model calls, no credit spend) when
 * the lead consumed the member's SendMessage in a turn that ended without a
 * final answer and was relying on the completion notification to wake it again.
 *
 * @param hasOtherActiveMember whether any *other* member of the team still has a
 *        pending/running task. False ⇒ this member is the last to finish.
 * @param hasRecentMemberMessage whether the lead inbox already holds a SendMessage
 *        from this member inside the dedup window.
 * @returns `true` to send the notification, `false` to skip it.
 */
export declare function shouldDeliverFrameworkNotification(hasOtherActiveMember: boolean, hasRecentMemberMessage: boolean): boolean;
/**
 * Implementation of AgentTaskManager
 * Manages the lifecycle of agent tasks executing sub-agents
 */
export declare class AgentTaskManagerImpl implements AgentTaskManager, ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    init(): void;
    onStop(): Promise<void>;
    private tasks;
    /**
     * 任务生命周期事件的 emitter。
     *
     * 上限调离 Node 默认的 10：这是一个 **hub** —— 同一个事件（尤其
     * `task-killed`）的订阅方天然就有好几路，且其中一路的数量随**并发在途
     * prompt** 增长：
     *
     * - `completion-bus` 常驻 1；
     * - `acp-team-bridge` 常驻 1；
     * - TUI 的 `use-team-progress` / `use-coordinator-workers` /
     *   `use-focused-member` 各 1（组件挂载期间）；
     * - `acp-agent` 每个在途 prompt 1（订阅/退订成对，见 acp-agent 的 cleanup）。
     *
     * 团队会话里几个 member 同时跑就越过 10，于是报
     * `MaxListenersExceededWarning: 11 task-killed listeners` —— 那是扇出，不是漏。
     *
     * **不设 0（不限）**：那会连真正的泄漏一起静音。留一个远高于正常扇出、又能
     * 兜住失控增长的有限值。
     */
    private eventEmitter;
    private waitPromises;
    private mainSession;
    /**
     * Track pending team-member notification timers for dedup/cancellation.
     * Key: "{teamName}/{memberName}", Value: NodeJS.Timeout
     */
    private pendingTeamNotifications;
    /**
     * Timer for auto-team completion cleanup.
     * Set when all auto-team members have finished; cleared if a new member spawns.
     */
    private autoTeamCleanupTimer;
    private autoTeamCleanupDepth;
    private readonly onTeamMemberStateChange;
    /**
     * Timer for periodic cleanup of completed/failed tasks.
     * Runs every 60 seconds to remove tasks that have been in a terminal state
     * for longer than COMPLETED_TASK_TTL_MS, preventing unbounded Map growth
     * in long-running sessions (memory leak fix for monorepo scenarios).
     */
    private completedTaskCleanupTimer;
    /**
     * Time-to-live for completed/failed tasks before automatic removal.
     * Tasks in terminal state for longer than this are eligible for cleanup.
     */
    private static readonly COMPLETED_TASK_TTL_MS;
    /**
     * Interval between cleanup sweeps.
     */
    private static readonly CLEANUP_INTERVAL_MS;
    /**
     * Maximum number of terminal team member sessions to keep in memory.
     * When exceeded, the oldest terminal team member's subAgentSession is
     * released to allow GC of its history (which can be very large).
     */
    private static readonly MAX_TERMINAL_TEAM_SESSIONS;
    /**
     * Register an existing agent task
     * @param task The task to register
     * @param skipStatusMonitoring If true, task is registered but status changes are not monitored
     */
    registerTask(task: AgentTask, skipStatusMonitoring?: boolean): void;
    /**
     * Get a specific task by ID.
     * Supports both internal task IDs (e.g. "agent-a1b2c3d4") and
     * team member agent IDs (e.g. "general-purpose-2@_auto_xxx").
     */
    getTask(id: string): AgentTask | undefined;
    /**
     * Get all tasks
     */
    getTasks(): AgentTask[];
    /**
     * Get tasks by status
     */
    getTasksByStatus(status: AgentTaskStatus): AgentTask[];
    /**
     * Get tasks by session ID
     * Matches against mainSessionId (the parent session that spawned the task)
     */
    getTasksBySession(sessionId: string): AgentTask[];
    /**
     * Wait for a task to complete
     *
     * `signal` 只结束**等待**，绝不取消任务本体：调用方（TaskOutput 的阻塞分支）
     * 跑在 SDK 的 tool 调用里，等待不可中断时整个物理 loop 都无法退栈，
     * 用户按 Esc 也只能强杀进程。被打断时返回当前（可能非终态）快照，
     * 与 shell 分支的 waitForShellTerminal 语义一致。
     */
    waitFor(id: string, timeout?: number, signal?: AbortSignal): Promise<AgentTask>;
    /**
     * Cancel a task
     */
    cancel(id: string): Promise<void>;
    /**
     * Subscribe to task events
     */
    on(event: AgentTaskEvent, listener: (task: AgentTask) => void): void;
    /**
     * Unsubscribe from task events
     */
    off(event: AgentTaskEvent, listener: (task: AgentTask) => void): void;
    /**
     * Remove a specific task by ID
     */
    removeTask(id: string): void;
    /**
     * Clear completed tasks
     */
    clearCompleted(): void;
    /**
     * Clear tasks for a specific session
     */
    clearBySession(sessionId: string): Promise<void>;
    /**
     * Subscribe to task status change events
     */
    private subscribeToTaskStatus;
    /**
     * Handle task status changes
     */
    private handleTaskStatusChange;
    /**
     * Internal: Resolve all waitFor promises for a task
     */
    private resolveWaitPromises;
    /**
     * Internal: Remove a waitFor promise
     */
    private removeWaitPromise;
    /**
     * Set the main session reference for task completion notifications
     */
    setMainSession(session: Session): void;
    /**
     * Get the configured main session
     */
    getMainSession(): Session | undefined;
    hasPendingTeamNotifications(teamName: string): boolean;
    cancelPendingTeamNotification(teamName: string, memberName: string): void;
    onTeamNotificationSettled(listener: TeamNotificationSettledListener): void;
    offTeamNotificationSettled(listener: TeamNotificationSettledListener): void;
    private emitTeamNotificationSettled;
    /**
     * Trigger completion notification for a task.
     *
     * All background tasks have teamContext (via auto-team), so notifications
     * are sent through the team mailbox with a delay for dedup.
     */
    private triggerNotification;
    /**
     * Schedule a delayed notification for a team member completion/failure.
     *
     * After a 4-second delay, checks if the teammate already sent a SendMessage
     * to team-lead (by scanning the inbox for recent messages from this member).
     * If so, the framework notification is skipped (dedup). Otherwise, a concise
     * status notification is written to team-lead's inbox.
     */
    private scheduleTeamMemberNotification;
    /**
     * Build a concise notification message for the team-lead inbox.
     * Contains only status metadata — no actual task output.
     */
    private buildTeamMemberNotification;
    /**
     * Check if all auto-team members have completed, and if so,
     * schedule cleanup after a delay so the UI has time to show final status.
     */
    private checkAutoTeamCompletion;
    /**
     * Cancel all pending team member notification timers.
     * Called during session/team cleanup.
     */
    private cancelPendingTeamNotifications;
    /**
     * Evict the oldest terminal team member sessions when the count exceeds
     * MAX_TERMINAL_TEAM_SESSIONS. Releases their subAgentSession references
     * to allow GC of potentially large conversation histories.
     *
     * This prevents unbounded memory growth when many team members are spawned
     * in long-running monorepo sessions.
     */
    private evictOldestTeamSessions;
    /**
     * Start periodic cleanup of completed/failed tasks.
     * Prevents unbounded growth of the tasks Map in long-running sessions.
     */
    private startCompletedTaskCleanup;
    /**
     * Remove non-team tasks that have been in a terminal state longer than TTL.
     * Team member task records and retained sessions are managed separately by
     * the team lifecycle and bounded session retention.
     */
    private cleanupExpiredTasks;
    /**
     * Stop the completed task cleanup timer.
     * Should be called during shutdown to prevent leaking timers.
     */
    stopCleanup(): void;
    /**
     * Wait for all running/pending tasks to reach a terminal state.
     * Used by CliExecutor to keep the process alive until background agents finish.
     * Fail-open: timeout / reject logs a warning and continues shutdown.
     */
    waitForRunningTasks(timeout?: number): Promise<void>;
}
