import { type BackgroundTask, Session, type SubagentLifecycleSnapshot } from '../../vendor/cbc-core/node/index.js';
import { AgentInputItem, RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
/**
 * Symbol for AgentTask dependency injection
 */
export declare const AgentTask: unique symbol;
/**
 * Tool call record for tracking execution progress
 */
export interface ToolCallRecord {
    name: string;
    timestamp: number;
    arguments?: Record<string, any>;
    status: 'running' | 'completed';
}
/**
 * Largest accepted wall-clock budget for `AgentTaskExecutionConfig.timeoutMs`.
 *
 * Node's `setTimeout` clamps any delay above 2^31-1 ms to 1 ms and emits
 * `TimeoutOverflowWarning`, so an oversized budget fires the watchdog
 * immediately instead of never timing out (observed with e.g. 3000000000).
 *
 * Declared next to the field, and enforced both where the value is resolved
 * (agent-tool's env reader) and where the timer is armed (agent-task), so a
 * future caller cannot arm an overflowing delay by passing `timeoutMs` directly.
 */
export declare const MAX_SUBAGENT_TIMEOUT_MS = 2147483647;
/**
 * Configuration for AgentTask execution
 */
export interface AgentTaskExecutionConfig {
    description: string;
    prompt: string;
    subagent_type: string;
    /**
     * 显式主模式（站立 agent 名：cli / ptc / minimal / create / multitask / 自定义 mainAgent 预设）。
     *
     * 与 `subagent_type` 正交：那个是「这个任务用哪个子代理预设跑」，这个是「leader 当前所在
     * 的模式」。子代理与正式团队成员都按它跑，使工具面 / Code Mode 与主会话一致
     * （issue #127405 · P1/P2）。
     * 缺省 = 从 `mainSession` 的持久站立模式兜底；没有持久模式时才退回既有子代理预设。
     */
    mainAgentName?: string;
    model?: string;
    resume?: string;
    /** History-only snapshot for interactive continuation, including non-persistent sessions. */
    resumeSnapshot?: Pick<Session, 'id' | 'storeId' | 'history' | 'meta' | 'lastMessageId' | 'hasCompactedHistory'>;
    /** Structured human follow-up, preserving image and queue-hold data. */
    initialInput?: AgentInputItem[];
    inputOrigin?: 'human';
    mainSession: Session;
    /**
     * If this AgentTask was launched via the Agent tool, this is the Agent tool callId
     * from the parent (main) session.
     */
    parentToolUseId?: string;
    captureOutput?: boolean;
    /**
     * Detached execution mode
     * - When true: Task runs in detached mode - intermediate messages and state updates are NOT forwarded to main session
     * - When false (default): Task runs in attached mode - all messages and state updates are forwarded to main session
     *
     * Note: In detached mode, billing/usage data, abort signals, and permission mode synchronization are still maintained.
     */
    detached?: boolean;
    /** Owned by a workflow run: progress belongs in the workflow UI, not the top-level agent tree. */
    isWorkflowTask?: boolean;
    /** Keep a finished task and its sub-agent history available from the main agent tree. */
    retainInAgentTree?: boolean;
    /** Snapshot the parent's active history on the first turn. */
    inheritParentHistory?: boolean;
    /**
     * Team context metadata (set when this task is a teammate in an Agent Team)
     * Used by TeamContextInterceptor to inject team communication prompts
     */
    teamContext?: {
        /** Name of the team this member belongs to */
        teamName: string;
        /** This member's name within the team */
        memberName: string;
        /** Names of all other team members (for context) */
        teamMembers: string[];
        /** Display color for UI differentiation (e.g., permission approval border) */
        color?: string;
    };
    /**
     * Whether this is a formal team member created via TeamCreate.
     * When false (default), even if teamContext is set, the task is considered
     * an implicit team member (background agent) — not a formal team member.
     * This affects notification routing and progress display filtering.
     */
    isFormalTeamMember?: boolean;
    /**
     * Skip linking this task to the parent session abort signal.
     * Coordinator workers must set this so Esc on the parent does not cancel them.
     * Do NOT set isFormalTeamMember for this — Esc still needs cancel().
     */
    skipMainSessionAbortLinkage?: boolean;
    /**
     * Maximum number of agentic turns (API round-trips) before stopping.
     * Passed through to AgentService.run() options.
     */
    maxTurns?: number;
    /**
     * Wall-clock budget (ms) covering the sub-agent model execution and the
     * completion wait. When exceeded, the sub-agent is aborted and the task is
     * marked failed. Omitted, non-positive or above
     * {@link MAX_SUBAGENT_TIMEOUT_MS} → no watchdog.
     */
    timeoutMs?: number;
    /**
     * Override permission mode for this task's session.
     * Takes priority over product config agent permissionMode.
     * Values: 'acceptEdits' | 'bypassPermissions' | 'default' | 'plan' | 'dontAsk' | 'auto'
     */
    permissionMode?: string;
    /**
     * Additional frontmatter hooks to register for this task's subagent scope.
     * Merged with agent definition hooks (if any) and registered via
     * ScopedHookRegistry before the task starts; auto-cleaned after.
     *
     * Used primarily by skill-tool fork path to carry the SKILL.md
     * frontmatter.hooks down into the fork subagent lifecycle.
     *
     * Shape: Partial<Record<HookEvent, HookConfig[]>>. Kept loose here to
     * avoid pulling in hook-protocol types into the agent-task-protocol.
     */
    additionalHooks?: Record<string, unknown>;
    /**
     * Label for logging when registering additionalHooks.
     * E.g. "skill 'commit'". Used by ScopedHookRegistry diagnostic output.
     */
    additionalHooksSourceLabel?: string;
    /**
     * Whether the source that produced `additionalHooks` is admin-trusted.
     * The caller (e.g. skill-tool) is responsible for evaluating the trust
     * status of the actual additionalHooks source — agent-task cannot infer
     * it from the `subagent_type` since that may be a trusted built-in agent
     * like `general-purpose` even when the hooks originate from an untrusted
     * user-local SKILL.md. When false/undefined, `additionalHooks` are only
     * registered if `allowUntrustedFrontmatterHooks` is enabled in settings.
     */
    additionalHooksAdminTrusted?: boolean;
}
/**
 * Result returned from AgentTask execution
 */
export interface AgentTaskExecutionResult {
    content: string;
    sessionId: string;
    renderer?: {
        type: 'text';
    };
    /**
     * 本次执行产生的 subAgent 历史的消息边界 id，供上层（agent-tool）透传到
     * ToolResult.subAgent，用于 resume 时按 id 定位切片回放（见 ToolResult.subAgent）。
     * afterId：执行前最后一条 id（窗口从它之后开始，undefined=从头）；
     * lastId：执行后最后一条 id（窗口到它为止含，undefined=本次无产出）。
     */
    afterId?: string;
    lastId?: string;
    /** Stable child identity and lifecycle persisted with the parent tool result. */
    descriptor?: SubagentLifecycleSnapshot;
}
export interface AgentTaskInvocationIdentity {
    readonly conversationRequestId: string;
    readonly rootRequestId: string;
}
/**
 * AgentTask interface - represents an agent task with execution capabilities
 * This interface defines the contract for all agent task implementations
 */
export interface AgentTask {
    readonly id: string;
    readonly title: string;
    readonly startTime: number;
    endTime?: number;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'killed';
    abortController?: AbortController;
    description?: string;
    prompt?: string;
    response?: string;
    agentType?: string;
    /** Isolation mode captured when the worker was spawned; stable across catalog reloads. */
    agentIsolation?: 'worktree';
    /** Implicit team member name (e.g. "Explore-1"), set for background agents */
    memberName?: string;
    sessionId?: string;
    mainSessionId?: string;
    result?: string;
    error?: string;
    /**
     * Whether this task is a formal teammate in an Agent Team (created via TeamCreate).
     * When true, completion notifications are skipped and task is shown in TeammateProgressView.
     */
    isTeamMember?: boolean;
    /**
     * Whether this task runs in background (detached) mode.
     * Background tasks don't forward intermediate messages to the main session.
     */
    isBackground?: boolean;
    /** Workflow-owned task; the workflow UI is its progress/navigation surface. */
    isWorkflowTask?: boolean;
    /** Finished task remains selectable from the main agent tree. */
    retainInAgentTree?: boolean;
    /**
     * Team context metadata, set when this task is a team member (formal or auto-team).
     * Used by triggerNotification() to determine if the task communicates via SendMessage.
     */
    teamContext?: {
        teamName: string;
        memberName: string;
        teamMembers: string[];
        color?: string;
    };
    /**
     * Tool call history for tracking execution progress
     * Lightweight in-memory record of tool invocations
     */
    toolCallHistory?: ToolCallRecord[];
    /**
     * Token usage statistics for this task
     */
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        /**
         * The context window size (input tokens) of the most recent model request.
         * This represents the current conversation context size, not cumulative usage.
         */
        lastContextWindow?: number;
    };
    /** Parent Agent tool call when this task has an associated tool card. */
    getParentToolCallId?(): string | undefined;
    /**
     * Initialize task with configuration
     * @param config Configuration for task execution
     */
    init(config: AgentTaskExecutionConfig): void;
    /**
     * Execute the task asynchronously
     * @returns Promise that resolves with the execution result
     * @throws Error if execution fails
     */
    execute(): Promise<AgentTaskExecutionResult>;
    getExecutionConfig?(): AgentTaskExecutionConfig | undefined;
    /** Resolves after execution, hooks, persistence and runtime cleanup finish. */
    whenSettled?(): Promise<void>;
    /** 幂等预留该任务所在根会话树的并发槽位。 */
    reserveExecutionSlot?(): void;
    /** 幂等释放已预留的并发槽位。 */
    releaseExecutionSlot?(): void;
    /**
     * Get the execution result
     * @returns The execution result if available, undefined otherwise
     */
    getResult(): AgentTaskExecutionResult | undefined;
    /**
     * Get the main session
     * @returns The agent task's parent session
     */
    getMainSession(): Session | undefined;
    /**
     * Get the sub-agent session (the session this task's agent runs in).
     * Available after task setup. A terminal formal teammate may temporarily
     * retain a history-bearing Session until explicit release or eviction.
     */
    getSubAgentSession(): Session | undefined;
    /** Immutable request-tree identity allocated for this task invocation. */
    getInvocationIdentity(): AgentTaskInvocationIdentity;
    /**
     * Request release of the sub-agent's runtime registrations and Session reference.
     * Release is deferred until cleanup finalization; existing persisted data is not deleted.
     */
    releaseSubAgentSession(): void;
    /**
     * Kill/abort the task
     * @returns Promise that resolves when the task is killed
     */
    kill(): Promise<void>;
    /**
     * Subscribe to status change events
     * @param listener Callback function that receives the status change event
     */
    onStatusChange?(listener: (event: {
        task: AgentTask;
        oldStatus: string;
        newStatus: string;
    }) => void): void;
    /**
     * Unsubscribe from status change events
     * @param listener Callback function to remove
     */
    offStatusChange?(listener: (event: {
        task: AgentTask;
        oldStatus: string;
        newStatus: string;
    }) => void): void;
    /**
     * Subscribe to progress events (fired once per captured tool_use), used to
     * drive stream-json `task_progress` events for background sub-agent tasks.
     */
    onProgress?(listener: (event: {
        task: AgentTask;
    }) => void): void;
    /**
     * Unsubscribe from progress events.
     */
    offProgress?(listener: (event: {
        task: AgentTask;
    }) => void): void;
}
/**
 * Event type for agent task lifecycle
 */
export type AgentTaskEvent = 'task-started' | 'task-completed' | 'task-failed' | 'task-cancelled' | 'task-killed';
/**
 * Listener notified after a team's delayed framework notification no longer
 * owns pending work. Consumers must re-check `hasPendingTeamNotifications`
 * because another member notification may still be outstanding.
 */
export type TeamNotificationSettledListener = (teamName: string) => void;
/**
 * Status of an agent task
 */
export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'killed';
/** True when a task will never leave this status (completed / failed / cancelled / killed). */
export declare function isTerminalStatus(status: string | undefined | null): boolean;
/**
 * Interface for AgentTaskManager
 * Manages the lifecycle of agent tasks
 */
export declare const AgentTaskManager: unique symbol;
export interface AgentTaskManager {
    /**
     * Register an existing task
     * @param task The task to register
     * @param skipStatusMonitoring If true, task is registered but status changes are not monitored
     * @throws 子代理并发槽位耗尽时拒绝注册；调用方必须回滚已产生的外部副作用
     */
    registerTask(task: AgentTask, skipStatusMonitoring?: boolean): void;
    /**
     * Get a specific task by ID
     * @param id Task ID
     * @returns The task, or undefined if not found
     */
    getTask(id: string): AgentTask | undefined;
    /**
     * Get all active and completed tasks
     * @returns Array of all tasks
     */
    getTasks(): AgentTask[];
    /**
     * Get tasks filtered by status
     * @param status Status to filter by
     * @returns Array of tasks with the specified status
     */
    getTasksByStatus(status: AgentTaskStatus): AgentTask[];
    /**
     * Get tasks filtered by main (parent) session ID
     * @param sessionId Main session ID to filter by
     * @returns Array of tasks spawned by the specified session
     */
    getTasksBySession(sessionId: string): AgentTask[];
    /**
     * Wait for a task to complete or fail
     * @param id Task ID
     * @param timeout Optional timeout in milliseconds
     * @param signal Optional abort signal that ends **only the wait**. The task
     *        itself keeps running; the current (possibly non-terminal) snapshot
     *        is returned so a cancelled turn can unwind instead of hanging.
     * @returns Promise that resolves with the completed task
     * @throws Error if task not found or timeout occurs
     */
    waitFor(id: string, timeout?: number, signal?: AbortSignal): Promise<AgentTask>;
    /**
     * Cancel a running task
     * @param id Task ID
     * @throws Error if task not found
     */
    cancel(id: string): Promise<void>;
    /**
     * Subscribe to task lifecycle events
     * @param event Event type to listen for
     * @param listener Callback function
     */
    on(event: AgentTaskEvent, listener: (task: AgentTask) => void): void;
    /**
     * Unsubscribe from task lifecycle events
     * @param event Event type to stop listening for
     * @param listener Callback function to remove
     */
    off(event: AgentTaskEvent, listener: (task: AgentTask) => void): void;
    /**
     * Remove a specific task by ID, releasing all references
     * @param id Task ID to remove
     */
    removeTask(id: string): void;
    /**
     * Clear all completed tasks from memory
     */
    clearCompleted(): void;
    /**
     * Clear all tasks for a specific session
     * @param sessionId Session ID
     */
    clearBySession(sessionId: string): Promise<void>;
    /**
     * Set the main session reference for task completion notifications
     * @param session The main session
     */
    setMainSession(session: Session): void;
    /**
     * Get the configured main session
     * @returns The main session or undefined
     */
    getMainSession(): Session | undefined;
    /**
     * Whether a delayed framework completion notification still owns work for
     * this team. `team_idle` must not be emitted before that notification is
     * durably delivered or deliberately deduplicated.
     */
    hasPendingTeamNotifications(teamName: string): boolean;
    /**
     * Drop one member's pending notification because the lead was already
     * told through another channel (e.g. an approved shutdown). Failure
     * notices carry the error text, so callers must not drop those.
     */
    cancelPendingTeamNotification(teamName: string, memberName: string): void;
    /**
     * Re-check hook for consumers waiting on delayed team notifications.
     */
    onTeamNotificationSettled(listener: TeamNotificationSettledListener): void;
    /**
     * Remove a delayed-notification settlement listener.
     */
    offTeamNotificationSettled(listener: TeamNotificationSettledListener): void;
    /**
     * Wait for all running/pending tasks to reach a terminal state.
     * Resolves immediately if no active tasks exist.
     * Fail-open: individual wait failures / timeouts are logged and do not throw.
     * @param timeout Optional timeout in milliseconds (default 600000, clamped 0-600000)
     */
    waitForRunningTasks(timeout?: number): Promise<void>;
}
/**
 * Interface for agent task output file management
 * Handles creating and appending to output files for background agent tasks
 */
export interface AgentTaskOutputFileManager {
    /**
     * Create an output file for a task
     * @param taskId The task ID
     * @param outputDir Optional output directory (defaults to user-isolated temp dir)
     * @returns The full path to the created output file
     */
    createOutputFile(taskId: string, outputDir?: string): Promise<string>;
    /**
     * Append content to a task's output file
     * @param filePath The full path to the output file
     * @param content The content to append
     */
    appendToOutputFile(filePath: string, content: string): Promise<void>;
    /**
     * Append content to a task's output file by task ID
     * This is a convenience method that resolves the file path internally
     * and delegates to appendToOutputFile
     * @param taskId The task ID
     * @param content The content to append
     */
    appendToOutputFileById(taskId: string, content: string): Promise<void>;
    /**
     * Get the output file path for a task
     * @param taskId The task ID
     * @param outputDir Optional output directory (defaults to user-isolated temp dir)
     * @returns The full path to the output file
     */
    getOutputFilePath(taskId: string, outputDir?: string): string;
    /**
     * 自 `fromOffset`（UTF-16 字符位）起的增量进度（CC getTaskOutputDelta /
     * BashOutput 同语义；游标量纲为 content.length 的字符计数，尾环与文件
     * 回退两路自洽——工具输出 ASCII 主体下 chars≈bytes）。写透尾环命中时
     * 零文件读——remote fs 场景每次轮询不再打远端；环外（尾环被截断）
     * 回退整文件读并标注省略量。
     */
    readProgressDelta(taskId: string, fromOffset: number): Promise<{
        content: string;
        offset: number;
        omittedBytes: number;
    }>;
    /**
     * 任务终态后释放该任务的内存尾环与游标账本（整任务条目删除；此后
     * readProgressDelta 走整文件回退，语义无损）。所有终态路径（completed/
     * failed/cancelled/killed）都应调用——只清完成路径会让 abort 后不再
     * 轮询的任务在长驻进程里滞留 ≤128KB/个。幂等。
     */
    finalizeOutputBuffer(taskId: string): void;
}
/**
 * Symbol for dependency injection
 */
export declare const AgentTaskOutputFileManager: unique symbol;
/**
 * Symbol for BackgroundTaskToolApprovalService
 * 后台任务工具授权服务的依赖注入符号
 */
export declare const BackgroundTaskToolApprovalService: unique symbol;
/**
 * BackgroundTaskToolApprovalService interface
 * 负责处理后台任务 session 中的工具调用权限自动化
 */
export interface BackgroundTaskToolApprovalService {
    /**
     * 检查 session 是否为后台任务会话
     * @param session 要检查的会话
     * @returns true 如果是后台任务会话，false 否则
     */
    isBackgroundTaskSession(session: Session): boolean;
    /**
     * 自动批准后台任务中的工具调用
     * @param item 工具调用项
     * @param session 后台任务会话
     */
    approve(item: RunToolApprovalItem, session: Session): void;
    /**
     * 处理后台任务中被拒绝的工具调用
     * 生成降级结果或错误消息返回给 Agent
     * @param item 工具调用项
     * @param session 后台任务会话
     * @param reason 拒绝原因
     * @returns 返回给 Agent 的输入项（通常为错误结果）
     */
    handleRejection(item: RunToolApprovalItem, session: Session, reason: string): Promise<AgentInputItem[]>;
    /**
     * 记录权限决策（用于审计和日志）
     * @param item 工具调用项
     * @param session 后台任务会话
     * @param decision 决策类型：'approved' 或 'rejected'
     */
    logApprovalDecision(item: RunToolApprovalItem, session: Session, decision: 'approved' | 'rejected'): void;
}
/**
 * ACP 模式下的 drain 触发器。
 *
 * 后台任务完成时 BackgroundTaskNotifierImpl 会将 `<task-notification>` 入队到
 * session.queue，然后需要触发一次空 run 让 interceptor drain 队列。在 TUI 模式下
 * 直接调 `agentService.runDefault` 即可；但在 ACP 模式下，必须经过 AcpView 的
 * `for await` 循环——否则 `createEventForwardingPromise` 不会被创建，模型的响应
 * 事件不会被转发给客户端。
 *
 * AcpView 实现此接口，将 drain 请求以内部 prompt item 的形式注入迭代器，
 * 复用 `drainQueuedMessages` 的完整事件转发链路。
 */
export declare const AcpDrainTrigger: unique symbol;
export interface AcpDrainTrigger {
    /**
     * ACP drain：往 prompt 迭代器推内部 item。
     * @returns true / void 已注入；false 没有可投递的 AcpAgent，调用方必须 fall through。
     */
    triggerDrain(session: Session): boolean | void;
    /**
     * fall-through 轮跑完后的 ACP 收尾。
     *
     * notifier 在 triggerDrain 返回 false 后会自己起本地轮（triggerEmptyRun /
     * deliverBufferedNotificationRun）把通知送达模型——那轮不经过 AcpView 的
     * drain 链路，没有 session_end 收尾帧，Web UI 输入框可能一直停在 running。
     * 本地轮**成功**送达后由 notifier 调本方法：实现方重新解析绑定本会话的
     * AcpAgent，解析得到就补发与正常 drain 轮相同的 session_end 收尾
     * （直发发起方 + 广播其他连接），解析不到（纯 TUI）时 no-op。
     */
    notifyFallThroughDrainCompleted?(session: Session): Promise<void>;
}
/**
 * stdio stream-json 模式下的"异步事件旁路"触发器（方向 B1：长轮询）。
 *
 * 背景：stream-json 是 client(cli-executor)—server 跨进程本地 HTTP，且**一问一答**——
 * 每条 stdin user 消息对应一次 `POST /internal/agent` 的 SSE 响应，`StreamJsonView`
 * 在该轮 result 后就 `response.end()`。后台任务在**轮次间隙**完成时，
 * `BackgroundTaskNotifierImpl` 入队 `<task-notification>` 后没有一条常开通道能把
 * drain-run 的事件推回客户端（详见 scripts/reproduce/stream-json-background-task/VERIFY-COMM.md）。
 *
 * 方案：客户端在 stdin 主循环之外**并行**挂一条长轮询
 * `POST /internal/agent { drainWait: true }`。server 端 handler 通过本触发器
 * `registerWaiter(session)` 挂起（park），等本 session 后台任务完成时
 * `BackgroundTaskNotifierImpl` 调 `signal(session)` 唤醒它 → 在**这条长轮询请求的
 * 上下文里**跑 drain-run → 现有 `StreamJsonView` 原样渲染到该 response → end。
 * 客户端收完立即重开，实现"异步任务完成事件实时回推"。
 *
 * 单连接语义：每 session 最多一条 parked waiter；重复 register 返回冲突态。
 */
export declare const StreamJsonDrainTrigger: unique symbol;
/** registerWaiter 的结果：唤醒来源。 */
export type DrainWaitOutcome = 'signaled' | 'timeout' | 'conflict' | 'aborted';
export interface StreamJsonDrainTrigger {
    /**
     * 长轮询 handler 调用：为该 session 注册一条 parked waiter，返回一个在
     * signal / 超时 / 冲突时 resolve 的 Promise。
     *
     * @param session   目标 session
     * @param timeoutMs 挂起上限，到点返回 'timeout' 让客户端重开（避免连接无限挂起）
     * @returns 'signaled'=有后台任务完成需要 drain；'timeout'=空转到点；
     *          'conflict'=该 session 已有 parked waiter（第二条应被拒绝）
     */
    registerWaiter(session: Session, timeoutMs: number): Promise<DrainWaitOutcome>;
    /**
     * 后台任务完成时由 BackgroundTaskNotifierImpl 调用：唤醒该 session 的 parked
     * waiter（若有）。返回是否命中了一条 parked waiter——命中说明由长轮询接管 drain，
     * notifier 不再需要 triggerEmptyRun。
     */
    signal(session: Session): boolean;
    /** 该 session 当前是否有 parked waiter。 */
    hasWaiter(session: Session): boolean;
}
/**
 * Symbol for BackgroundTaskNotifier
 *
 * 后台任务（bash / powershell `run_in_background` 或 auto-background）完成时
 * 主动把 `<task-notification>` 注入对应 session 的消息队列，让主 agent 在下一轮
 * 自动看到完成事件，不再需要轮询 TaskOutput。对齐 Claude Code 的
 * `enqueueShellNotification` 推送语义。
 */
export declare const BackgroundTaskNotifier: unique symbol;
/**
 * BackgroundTaskNotifier interface
 *
 * 实现需保证：
 * 1. **幂等**：同一 task 多次调用只产生一条通知（依赖 `BackgroundTask.notified` flag）
 * 2. **失败安全**：找不到 session、enqueue 抛错都不能影响调用方主流程
 * 3. **idle 立即投递**：idle session 入队后通过 `queueMicrotask` 触发一次 drain
 *    （ACP 走 `AcpDrainTrigger`、stream-json 走 `StreamJsonDrainTrigger`、
 *    其余走空数组 `runDefault`）
 * 4. **Mode B 下 busy 必须挂起重投**：Mode B（product feature
 *    `MessageQueueDeferredDispatch`）下 `session.queue` 只是 rich queue 的展示镜像，
 *    `MessageQueueAgentRunInterceptor` 的空数组 drain 分支、"与新用户输入合并"分支、
 *    `IdleQueueDrainService`、`InterruptionService` 和 AcpView 回合尾的 drain 全部被
 *    显式短路，通知会永久留在队列里（issue #83856）。所以 busy 时要订阅 canonical
 *    RunState，等落到 end-equivalent idle 再补投一次。Mode A 的兜底仍在，由它们负责，
 *    实现不应重复挂第二个 drainer
 */
export interface BackgroundTaskNotifier {
    /**
     * Push a task-notification for the given background task.
     *
     * Caller responsibilities:
     * - 已确保 `task.status` 已更新为终态（`completed` / `failed` / `killed`）
     * - 已确保 `task.endTime` 已设置
     * - 传入的 session 必须是 task 启动时所在的那个（bash-tool 持有 `execCtx.session`）
     *
     * Implementation responsibilities:
     * - 翻 `task.notified` flag 防重；
     * - 拼装 `<task-notification>` XML 并以 `isMeta=true` 入队；
     * - idle 时 `queueMicrotask` 触发 drain，busy 时挂起等 idle 后补投。
     *
     * @param task 已完成（含 killed/failed）的后台任务
     * @param session task 启动时所在的 session
     * @param options.deferDrain 只入队，不主动触发 drain。
     *
     *   给"用户在界面上主动结束任务"这类交互用：模型**必须**知道任务已经没了（否则
     *   后续推理基于「它还在跑」的错误前提，还会去调一个已不存在的 TaskOutput），但
     *   用户点一下删除按钮不该立刻烧一轮模型对话。通知留在队列 / 缓冲里，等下一次真实
     *   用户输入时一起送达；常驻 idle 重投也不会替它抢跑（`scheduleDrain` 整段跳过）。
     */
    notifyCompletion(task: BackgroundTask, session: Session, options?: {
        deferDrain?: boolean;
    }): void;
    /**
     * Push an arbitrary pre-built (already-idempotent-checked) event string into
     * the session's message queue, reusing the exact same busy/idle drain
     * scheduling as {@link notifyCompletion} (`scheduleDrain`：idle 时
     * `queueMicrotask` 触发 drain、busy 时挂起等 idle 后补投，ACP/stream-json
     * 走对应触发器)。
     *
     * 与 `notifyCompletion` 的区别：本方法**不**做 per-task `notified` 幂等去重
     * ——调用方（如 MonitorTool）自己按增量 tick 决定是否推送，一次 tick 一条事件，
     * 没有"同一事件重复推送"的语义需要去重。
     *
     * 用于非"后台任务终态完成"的反应式事件源（如 MonitorTool 的增量输出事件，
     * issue #74426），复用同一条"外部事件 → 主 agent"通道，避免另起一套
     * enqueue + drain 逻辑。
     *
     * @param session 目标 session
     * @param xml 已拼装好的事件文本（应包含可被 `MessageUtils.isSystemInjectedContent`
     *   识别的标签，否则会被 `UserQueryWrapperAgentRunInterceptor` 误包成 user_query）
     */
    notifyEvent(session: Session, xml: string): void;
    /**
     * 请求（重新）挂上 idle 重投，供宿主侧在"通知没消费干净"时交还控制权。
     *
     * 典型调用方是 `AcpView`：一条 drain item 内如果因为被 abort、期间有别的 run 抢先
     * 开跑、或触到轮次上限而提前退出，剩余通知仍在 `session.queue` 里 —— 必须有人负责
     * 下一次 idle 再投一遍，否则又回到 #83856 的"入队了没人取"。
     *
     * 幂等：已经挂着有效订阅时是 no-op。非 Mode B 下不挂（Mode A 的 interceptor /
     * `IdleQueueDrainService` 兜底仍在，重复挂会并发触发多余的空 drain run）。
     */
    requestIdleRetry(session: Session): void;
}
