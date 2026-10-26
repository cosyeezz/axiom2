import { Deferred } from '@celljs/core';
import { type AgentInputItem, ApprovalOptions, type Checkpoint, FinalStopReason, NotificationType, PermissionMode, ReasoningEffortLevel, type ResponseStreamEvent, type RunItem, type RunResult, type RunState, type RunToolApprovalItem, type SdkCapabilities, SessionEndReason, SessionStartSource, type StreamedRunResult, type TerminalEvent, type ToolDeferOverlaySnapshot, ToolPermissionContext, type ToolPermissionResult, type Usage } from '../../../cbc-shared/node/index.js';
import { Command } from '@genie/product';
import { BehaviorSubject, Subject } from 'rxjs';
import type { HumanInputSurface } from '../agent/human-input-surface';
import type { CompactionLineage } from '../context/compaction-lineage';
import type { InternalHookContext } from '../hooks/hook-protocol';
import { BackgroundTask } from './background-task-protocol';
import type { SessionRunStateSnapshot } from './session-run-state-machine-protocol';
import type { Lane, LanePointer, SessionKey, SessionStoreEntry } from './session-store-contract';
export declare const SessionFactory: unique symbol;
export declare const SessionManager: unique symbol;
export declare const SessionStore: unique symbol;
export declare const SessionHistoryCleanService: unique symbol;
export declare const SessionHookManager: unique symbol;
export declare const AgentInputItemProcessor: unique symbol;
export declare const RunItemProcessor: unique symbol;
export declare const InterruptionService: unique symbol;
export declare const MessageQueueManager: unique symbol;
export declare const ModelResponseInterceptor: unique symbol;
export declare const InputHistoryService: unique symbol;
export declare const IdleQueueDrainService: unique symbol;
export declare const TurnMetricsReporter: unique symbol;
export declare const CURRENT_CHAT_SESSION = "current-chat-session";
/**
 * 发起本次请求的客户端随请求透传的、用于 `/v2/report` 遥测归属的公共字段。
 *
 * 全字段可选，缺失字段由进程级 `ClientInfoProvider` / `UserinfoProvider` / product 配置兜底。
 * 与进程级 `ClientInfo` 区分：本类型描述发起本次请求的客户端。
 */
export interface TelemetryClientInfo {
    ideType?: string;
    /** 二级归属：发起本次请求的功能模块 / 业务入口 */
    featureModule?: string;
    ideName?: string;
    ideVersion?: string;
    machineId?: string;
    sessionId?: string;
    extName?: string;
    extVersion?: string;
    downloadChannel?: string;
    userAgent?: string;
    userId?: string;
    username?: string;
    userNickname?: string;
    enterprise?: string;
    enterpriseId?: string;
    /** 发起端 IANA 时区，如 Asia/Shanghai */
    timezone?: string;
    /** 发起端公网出口 IP */
    clientIp?: string;
    os?: string;
    arch?: string;
    osVersion?: string;
}
export declare const TELEMETRY_CLIENT_INFO_KEYS: ReadonlyArray<keyof TelemetryClientInfo>;
export declare const TELEMETRY_CLIENT_INFO_META_KEY = "telemetryClientInfo";
/** 上报点塞进 event payload 的临时载体字段名，由 `TelemetryClientInfoEventProcessor` 读取后删除。 */
export declare const TELEMETRY_CLIENT_INFO_CARRIER = "__telemetryClientInfo";
/**
 * Token计算请求标记
 * 用于标记session.meta中的token计算请求
 */
export declare const META_TOKEN_CALCULATION_REQUEST = "__token_calculation_request__";
/**
 * Token计算回调标记
 * 用于标记session.meta中的token计算回调函数
 */
export declare const META_TOKEN_CALCULATION_CALLBACK = "__token_calculation_callback__";
/**
 * `/context` 假 run 刚装上的诊断 abort。由链首 interceptor 写入，
 * calculateSession 只认这个句柄，避免链中 await 时并发真实 run 换柄后取样错误。
 */
export declare const META_TOKEN_CALCULATION_ABORT = "__token_calculation_abort__";
export type AgentState = 'agent_pending' | 'agent_start' | 'agent_tool_start' | 'agent_tool_end' | 'agent_handoff' | 'agent_end';
/**
 * Fine-grained execution phase for loading UI diagnostics.
 *
 * Phase transition flow and emission sites:
 *   preparing        → agent-service.ts        (after interceptor loop, before runner)
 *   model_requesting → runner-factory.ts        (callModelInputFilter, just before API call)
 *   model_streaming  → session-manager.ts       (first raw_model_stream_event with choices)
 *   model_done       → session-manager.ts       (response_done event)
 *   tool_executing   → agent-factory.ts         (agent_tool_start event)
 *   idle                    → agent-factory.ts         (agent_end event)
 *   waiting_for_permission  → interruption-service.ts  (showHead — tool approval queued)
 *   waiting_for_user        → interruption-service.ts  (showHead — AskUserQuestion queued)
 *   retrying                → interruption-service.ts  (auto-retry after network/stream/model error)
 *   finalization_file_projection_sync
 *                           → hooks/finalization-file-projection-sync-hook.ts
 *                             (Stop hook 开头立即 emit 的静默 finalization phase，
 *                              锁定 chatState 覆盖前端 isEnd 触发的 IDLE 副作用，但不显示 UI 文案)
 *   finalization_file_projection_sync_notify
 *                           → hooks/finalization-file-projection-sync-hook.ts
 *                             (同 hook，延迟 PHASE_NOTIFY_DELAY_MS 后若 doSyncBack 仍在运行
 *                              则 emit，触发 UI 显示"正在同步文件"提示)
 */
export type AgentPhase = 'preparing' | 'model_requesting' | 'model_streaming' | 'model_done' | 'tool_executing' | 'waiting_for_permission' | 'waiting_for_user' | 'retrying' | 'finalization_file_projection_sync' | 'finalization_file_projection_sync_notify' | 'idle';
export type AgentRetryReason = 'network';
export interface AgentPhaseInfo {
    phase: AgentPhase;
    toolName?: string;
    toolCallId?: string;
    streamingToolName?: string;
    startedAt: number;
    /**
     * 仅 finalization_file_projection_sync_notify phase 使用，承载 SYNC/COMMIT 子阶段的实时进度。
     * 通过 ACP `_meta['codebuddy.ai/agentPhase']` 整对象透传到 desktop adapter，
     * 在 progress-phase-formatter 中编码进 type 字符串后缀供 UI 解析。
     */
    progress?: {
        kind: 'sync' | 'commit';
        current: number;
        total: number;
    };
    /**
     * 仅 retrying phase 使用，经 ACP `_meta['codebuddy.ai/agentPhase']` 透传给上层。
     * 缺省表示原因未分类（如流超时），不代表网络正常。
     */
    retry?: {
        reason: AgentRetryReason;
    };
}
export declare const AgentPhaseUtils: {
    /** Create an AgentPhaseInfo with the current timestamp. */
    create(phase: AgentPhase, toolName?: string): AgentPhaseInfo;
    /** Emit a phase transition on a session (safe to call with undefined session). */
    emit(session: {
        phaseSubject?: {
            next(v: AgentPhaseInfo): void;
        };
    } | undefined, phase: AgentPhase, toolName?: string): void;
    /**
     * Convert AgentPhaseInfo to a short display label.
     * Returns undefined for idle or missing phase (caller should skip rendering).
     */
    getLabel(info?: AgentPhaseInfo): string | undefined;
};
export interface AgentExecutionTelemetry {
    agentName: string;
    agentVersion?: string;
    startTime: number;
    inputLength: number;
    inputType: string;
    modelId: string;
    modelName: string;
    maxTurns?: number;
    isStreaming: boolean;
    temperature?: number;
    maxTokens?: number;
    command?: string;
    traceId?: string;
    currentTurn?: number;
    /**
     * 首 token 到达本地时间戳（Date.now() ms），由 model-provider 在 SSE 首个
     * meaningful chunk 到达时写入；流式专用，失败/非流式时为空。
     * 供 telemetry-service 上报 chat_message_response.firstTokenAt 使用。
     * Issue #46366。
     */
    firstTokenAt?: number;
    /**
     * Renderer 透传的用户点击发送时间戳（Date.now() ms），由 acp-agent
     * applyUpstreamMeta 从 _meta['codebuddy.ai'].clientSendTime 读取。
     * 用于计算 message 维度用户视角 TTFT（clientSendTime → 首 token）。
     */
    clientSendTime?: number;
    /**
     * CLI 进入 prompt 的时间戳（Date.now() ms），由 acp-agent prompt 方法赋值。
     * 用于计算 message 维度模型视角 TTFT（promptStartTime → 首 token）。
     */
    promptStartTime?: number;
    /**
     * 标记本轮 message 是否已上报过 message 维度 TTFT。
     * 首个 meaningful token 到达时若为 false 则上报并置 true；
     * 每轮 message 开始时 reset 为 false（与 firstTokenAt reset 同处）。
     */
    messageTtfbReported?: boolean;
    /**
     * 流式响应首个 chunk 的 id（chat.completion.chunk.id），由 model-provider 在 SSE
     * 解析时写入。供自定义模型埋点 custom_model_usage 透传到后端做链路对齐。
     * 每轮 message 开始时与 firstTokenAt 一同 reset，避免上一轮值污染本轮。
     */
    chunkId?: string;
}
export type HistoryReloadReason = 'compact-pre-message' | 'compact-blocking' | 'compact-max-token' | 'checkpoint-revert' | 'content-filter';
export interface HistoryReloadEvent {
    /** Reload source for logging and observability. */
    reason?: HistoryReloadReason;
}
/** Active-history 投影用的父指针覆盖表（运行时字段，不落盘）。 */
export type ConversationParentOverlay = Readonly<Record<string, string | null>>;
export interface PreToolUseHookResult {
    allowed: boolean;
    modifiedInput?: Record<string, any>;
    message?: string;
    permissionDecision?: 'allow' | 'deny' | 'ask';
    permissionDecisionReason?: string;
    runtimeSecurity?: Record<string, unknown>;
    /**
     * hook 声明的审批元数据（issue #121874）。
     *
     * 来源：PreToolUse hook 在 `hookSpecificOutput['codebuddy.ai/approval']` 里携带的
     * `{ policyId, category, kind }`（已过形状校验）。acp-agent 把它展开进审批请求的
     * `toolCall._meta`（`codebuddy.ai/approvalPolicyId|approvalCategory|approvalKind`），
     * 驱动宿主审批 UI 的分类与文案 —— 宿主只认协议键，不认识任何具体工具。
     */
    approvalMeta?: Record<string, string>;
    /** PreToolUse `continue:false` — stop the current turn after the deny result is recorded. */
    preventContinuation?: boolean;
}
export interface Session {
    id: string;
    /**
     * Optional store ID for persistence file naming
     * When set, SessionStore uses this as the filename instead of id
     * Format: agent-{8} for sub-agent sessions
     */
    storeId?: string;
    /**
     * Current agent name for this session
     * Set when the agent starts running, used for tool filtering and other agent-specific logic
     */
    agentName?: string;
    history: AgentInputItem[];
    /** Runtime-only parent repair used by active-history projections（内容过滤链业务字段）. */
    conversationParentOverlay?: ConversationParentOverlay;
    /**
     * REPL 沙箱执行深度（运行时临时计数，非持久化）。
     *
     * REPL cell 里 `await Bash({...})` 等子工具经 broker 执行时 `+1`/`-1`（try/finally，
     * 支持 `Promise.all` 并发子工具）。子工具的 UI 流式更新（`bash-tool` /
     * `powershell-tool` 的 `updateToolResult`）看到 `> 0` 就跳过 `inputSubject.next`——
     * 否则每个内部子工具各自用新 callId 从 0 计时推流，UI 会把这些"找不到归属组"的
     * 结果各自渲染成孤立条目，表现为"...running Ns 反复重置"。REPL 改由外层统一推一条
     * 聚合流式（见 repl-tool.ts / repl-worker-manager.ts）。
     */
    replSandboxDepth?: number;
    /**
     * issue #53191：本会话已锁定的 prompt cache 档位（运行时临时值，非持久化）。
     *
     * 由 model-provider 在首次发请求时按 env kill switch
     * （`CODEBUDDY_DISABLE_PROMPT_CACHING_1H`）解析一次并写入，之后整个会话复用。
     * **必须 latch**：档位直接决定上游 prompt cache 的 TTL，会话中途翻转会把已建立的
     * 服务端缓存整块打废（对齐 claude-code 把 1h 资格 latch 到 bootstrap state 的理由）。
     * 取值与服务端枚举一致，见 `services/pkg/enum/cache_retention.go`。
     */
    cacheRetention?: 'disabled' | 'short' | 'long';
    state?: RunState<any, any>;
    /** Emitted after a physical run releases its lifecycle owner and abort links. */
    runSettledSubject?: Subject<void>;
    createdAt: number;
    updatedAt: number;
    meta?: Record<string, any>;
    resultSubject: BehaviorSubject<RunResult<any, any> | StreamedRunResult<any, any> | undefined>;
    inputSubject: Subject<AgentInputItem>;
    /**
     * Unconsumed post-append user echoes for stream-json's late subscriber,
     * including sessions with local transcript persistence disabled.
     */
    persistedUserMessageSubject?: BehaviorSubject<AgentInputItem[] | undefined>;
    historyReloadSubject: Subject<HistoryReloadEvent>;
    /** Live-only fan-out; durable history replay is projected separately. */
    combineSubject: Subject<CombineEvent>;
    /** Root live event sink inherited by nested subagents. */
    subagentRootCombineSubject?: Subject<CombineEvent>;
    localExecuteSubject: BehaviorSubject<InputText[][]>;
    modelSubject: Subject<ResponseStreamEvent>;
    interruptionSubject: BehaviorSubject<RunToolApprovalItem | undefined>;
    abortController: AbortController;
    abortSignal: AbortSignal;
    /**
     * A prompt/run has been accepted but AgentService has not installed the
     * fresh AbortController yet. Interrupts in this window must be carried
     * forward; aborting the stale session controller alone is not enough.
     */
    runStartupPending?: boolean;
    /**
     * Set when an interrupt arrives while runStartupPending is true. Consumed
     * once by AgentService.run after the fresh AbortController is installed.
     */
    pendingRunCancelledAtStartup?: boolean;
    /**
     * 最近一次 `abortController.abort()` 的发起语义。
     *
     * - `'user'`（默认）= 用户主动中断（Ctrl+C、ESC、cancel 按钮、ACP cancel 等交互级取消）
     * - `'internal'` = 进程内部流程切换（turn 结束、session 切换、compact 流程等），
     *   不代表"用户要停掉当前工具"
     *
     * BashTool 的 auto-background 路径会基于此字段决定是否真的把正在跑的 shell 命令 kill：
     * 遇到 `'internal'` 时保留运行中的命令（在前台跑完或超时自动转后台），避免并发调用
     * 或流程切换时把 `yarn package` / `docker build` 这类长命令冤杀。
     *
     * 触发 abort 的调用方**应当**在 abort 前先设置这个字段；未设置时默认按 `'user'`
     * 处理（保持旧行为），该字段在 BashTool 侧是**严格的"不杀"条件**，只有显式标
     * `'internal'` 才不杀。
     *
     * 目前该字段是推进式的增量优化：基础设施就位后，再逐个内部触发点改标 `'internal'`。
     */
    lastAbortReason?: 'user' | 'internal';
    usage: Usage;
    options: SessionOptions;
    agentState?: AgentState;
    /**
     * Canonical run state snapshot.
     *
     * Implemented as a getter/setter pair (see `SessionFactory`): writing here
     * automatically pushes the new snapshot to `runStateSubject` after a
     * `(status, lastTransition.at)` dedupe check, so the subject is always in
     * lockstep with the property and `SessionRunStateMachine.getSnapshot()`.
     *
     * Always defined for sessions created via `SessionFactory`; the optional
     * marker is kept only to soften the type for fixtures that build sessions
     * literally (those should still initialize it to `{ status: IDLE }`).
     */
    runState?: SessionRunStateSnapshot;
    /**
     * Run 身份令牌：当前正在执行的一轮 run 的 `RunContext` 引用。
     *
     * 由 `DefaultAgentFactory` 在 `agent_start` 时写入、在配对的 `agent_end`
     * 时清空。因为 agent 实例是**跨 run 复用**的（AgentManager.agentMap），同一个
     * `agent.on('agent_end', ...)` 监听器会被这个 agent 上的每一轮 run（含被 abort
     * 掉的上一轮的异步收尾、error-recovery / compact / silentAbort 等手动 emit）触发，
     * 而监听器本身不携带 run 身份。若不加区分，一次"迟到/串扰的 agent_end"就会把
     * 正在执行的**新一轮** run 的状态机从执行态打回 idle —— 表现为 TUI 显示空闲、
     * spinner 消失、ESC 无法中断（只能退出程序）。
     *
     * SDK 每次 `Runner.run` 都 `new RunContext(options.context)`，`agent_start` /
     * `agent_end` 及手动 `emit('agent_end', result.state._context, ...)` 传的都是这个
     * **每-run 唯一**的实例。factory 据此只在 `ctx === activeRunContext` 时才驱动
     * `AGENT_ENDED`，拒绝 stale end。
     *
     * 类型用 `unknown`：只做 `===` 身份比较，**不解引用其内部**，避免 session-protocol
     * 反向依赖 SDK 的 RunContext 类型。
     */
    activeRunContext?: unknown;
    agentStateSubject: BehaviorSubject<AgentState | undefined>;
    /**
     * Run state change notifier (canonical source for derived TUI hooks).
     *
     * `BehaviorSubject` semantics:
     * - New subscribers immediately receive the current snapshot, so hooks
     *   don't need a separate "read initial value via getSnapshot()" path.
     * - The subject is fed exclusively by `runState` setter, which dedupes on
     *   `(status, lastTransition.at)` so spurious self-assignments don't
     *   trigger redundant emissions.
     *
     * `SessionRunStateMachine.getChange$()` is implemented on top of this
     * subject; once all consumers migrate off `agentState` / `phaseSubject`
     * (PR-H), this becomes the single subscription source for run state.
     */
    runStateSubject: BehaviorSubject<SessionRunStateSnapshot>;
    command?: Command;
    telemetry?: AgentExecutionTelemetry;
    /**
     * Start time of the current/last agent request.
     * Set by TelemetryRunInterceptor at the beginning of each agent execution.
     * Unlike telemetry (which is cleared after each API response), this persists
     * until the next request starts, so it's available when creating result messages.
     */
    lastRequestStartTime?: number;
    /**
     * 当前「外部用户回合」的起点快照，供 `TurnMetricsReporter` 在回合结束时算出
     * 耗时与 token 增量（`✔ Worked for 1m 31s · 12.4k tokens`）。
     *
     * 为什么不复用 `lastRequestStartTime`：后者由 `TelemetryAgentRunInterceptor`
     * 在**每次模型请求**前无条件写入，自动上下文压缩（compact）与内部续跑都会把它
     * 刷成新值，导致一个触发过压缩的长回合算出来的耗时明显偏小。本字段只在
     * `beginExternalUserRequest` 赋值——那里是所有入口（TUI / ACP / headless /
     * remote-control）都必经的「用户主动发起新请求」边界，内部续跑不会经过。
     *
     * 一次性消费语义：`TurnMetricsReporter` 写入记录后立即置为 undefined。这同时
     * 承担三个职责——排除后台任务空运行这类非用户发起的结束、防止重复的
     * `AGENT_ENDED` 写出两条记录、保证下一轮从干净状态开始。
     */
    currentTurn?: TurnStartSnapshot;
    /**
     * effective `maxTurns` used by the most recent top-level `AgentService.run()`
     * call for this session (issue #82434). Set unconditionally at the top of
     * `AgentService.run()` — before any hook/interceptor runs — to the resolved
     * value (caller-provided `--max-turns` > env `CODEBUDDY_CODE_MAX_TURNS` >
     * `DEFAULT_MAX_TURNS`).
     *
     * Purpose: internal continuation runs that don't go through the CLI/HTTP
     * entrypoint again (e.g. `InterruptionService.continueAgentWithMessage`,
     * used by `StructuredOutputStopHook` when the model didn't call the
     * StructuredOutput tool) have no access to the user's original `--max-turns`
     * flag. Without this, such continuations silently fall back to
     * `DEFAULT_MAX_TURNS` (500), letting a single logical request balloon far
     * past what the user requested. Continuation call sites should read this
     * field and pass it through as `options.maxTurns` explicitly.
     */
    lastRunMaxTurns?: number;
    /**
     * Latest agent-loop model call number (`providerData.stepSeq`). Unlike the
     * SDK turn counter it survives runs, compaction and resume; see
     * `allocateModelStepSeq`.
     */
    modelStepSeq?: number;
    /** Compactions of this Session's context; see `getCompactionLineage`. */
    compactionLineage?: CompactionLineage;
    queue: AgentInputItem[];
    queueSubject: BehaviorSubject<AgentInputItem[]>;
    /**
     * 请求输入框回填一段文本（放到已有输入内容上方，换行分隔）。
     *
     * 用于「用户 Esc 中断且队列里只有 queue(Tab) 消息、没有 steer 消息」的场景：
     * 此时 queue 消息不发送，而是回填到输入框供用户继续编辑（对齐 codex）。
     * 由 IdleQueueDrainService 发起，InputBox 订阅消费。
     *
     * `images`（可选）携带被回填消息里的图片，InputBox 据此重新注册图片，
     * 保证回填文本里的 `[Image #N]` 占位符仍能解析出图片、重发不丢图。
     */
    queuedTextRefillRequest$: Subject<{
        text: string;
        images?: Array<{
            placeholderId: number;
            dataUrl: string;
        }>;
    }>;
    /**
     * Snapshot of the queue at the moment of the most recent user cancel.
     *
     * `cancelSessionRuntimeState` flushes `queue` / `queueSubject` to prevent
     * drain-after-cancel "ghost resume" (see issue #38609). Some consumers
     * (telemetry, debug UI, future replay tooling) still want to know what
     * was discarded — they should read this field instead of `queue`.
     *
     * - Populated only when cancel actually had items to drop (length > 0).
     * - Overwritten on each cancel; not persisted across sessions.
     * - Cleared when a fresh agent run starts (see AgentService.run).
     */
    lastCancelledQueue?: AgentInputItem[];
    /**
     * Set while a user-cancelled run is still writing its bookkeeping to history
     * (the `Interrupted by user` assistant record and/or the incomplete
     * tool-call results).
     *
     * Why it exists: on cancel, `InterruptionService` writes those records
     * through `agentService.runDefault(...)`, while the queued messages from the
     * cancelled turn also want to be dispatched. Both go through the full
     * interceptor chain, so whichever reaches
     * `HistoryAgentRunInterceptor.addHistory` first wins — the queued user
     * message could land *before* the interrupt record, rendering
     * `Interrupted by user` under the wrong (queued) message instead of under
     * the turn it actually interrupted.
     *
     * Ordering is **causal, not timed**: `IdleQueueDrainService` simply stands
     * down while this flag is set, and `InterruptionService` clears it in its
     * `finally` and then explicitly calls `requestDrain(session)`. So the drain
     * happens *because* bookkeeping finished, not after a guessed delay.
     *
     * A plain boolean (rather than a promise to await) is deliberate: there is
     * no publish/settle pair to get wrong, so "published but never settled"
     * — which would strand the queue — cannot happen. The `finally` runs on
     * every exit path, including when the bookkeeping run itself throws.
     */
    cancelBookkeepingInFlight?: boolean;
    conversationRequestId?: string;
    /**
     * Run id preassigned by the server surface's query()
     * (@tencent-ai/agent-cli/server). When TraceStartHook clears
     * conversationRequestId for a new turn it adopts this value instead (then
     * clears it), keeping QueryTicket.runId identical to the kernel
     * conversationRequestId. Bin modes never set it; behavior is unchanged.
     */
    pendingConversationRequestId?: string;
    /**
     * 后台任务通知 drain 轮是否正在跑（#89130 后续）。
     *
     * 由 `acp-view.ts` 的 `drainBackgroundTaskNotificationsUntilEmpty` 在执行期置 true、
     * `try/finally` 在全部出口清除。用途：drain 轮进行中到达的用户 prompt 经 steer 链路插入
     * 当前轮（`AcpView.tryInjectPromptIntoDrainRun` → `SteerInputBuffer`），而非
     * `holdUntilRunIdle` park 到整轮结束。
     */
    isBackgroundDraining?: boolean;
    /** Renderer 透传的全链路业务关联 ID（仅 desktop 入口有；裸 CLI / IDE 为 undefined） */
    promptRequestId?: string;
    /**
     * 本轮用户 message 进入 agent 处理（AgentService.run入口）的本地时间戳（Date.now() ms）。
     * 由 AgentService.run 在每次真实 run 入口写入，用于度量"收到 message → 发出首个模型请求"的耗时。
     * stdio 常驻模式下第一次 prompt 该耗时明显偏高，靠此埋点定位。
     */
    promptReceivedAt?: number;
    /**
     * 本轮 message 递增序号：第 1 次为 1，第 n 次为 n。由 AgentService.run 在每次真实 run 入口自增。
     * 供model-provider 打点时区分"第一次 prompt"与"第 n 次 prompt"。
     */
    promptSeq?: number;
    /**
     * 本轮 message 是否已记录过"收到 message → 发出模型请求"耗时。
     * 一次 run 内工具循环会多次发模型请求，只在首个模型请求发出时打点，之后置true。
     * 每次 AgentService.run 入口 reset 为 false。
     */
    firstModelRequestTimingReported?: boolean;
    /**
     * 本轮 runner.run 启动时刻（Date.now() ms），由 AgentService.run 在 dispatch 到 runner 前写入。
     * 供 model-provider 在首个模型请求发出时额外输出"runner 启动 → 模型请求"这段耗时，
     * 与 run 各阶段分段日志闭环定位耗时。
     */
    runnerStartedAt?: number;
    /**
     * stdin 收到本条用户 message 的时刻（Date.now() ms），由 AgentController.run 从
     * RunRequest.stdinReceivedAt 暂存。AgentService.run 入口若发现它存在，就用它（而非
     * run 入口时刻）作为 promptReceivedAt 起点，从而把 prompt 到达后等 readyDeferred /
     * agent 就绪 的耗时也算进"收到 message → 发出模型请求"。消费后即清空，避免下一轮误用。
     */
    pendingStdinReceivedAt?: number;
    /** Trace ID for distributed tracing, propagated from upstream (SDK/application) or self-generated */
    traceId?: string;
    /**
     * Trace ID of the most recent conversation turn for this session.
     * Unlike `traceId` (which TraceStopHook clears at the end of each turn),
     * this persists across turns so diagnostics surfaces (e.g. /doctor)
     * can always reveal the last main-agent request trace id.
     */
    lastConversationTraceId?: string;
    /** Parent span ID from upstream caller, used to link CLI trace as child of upstream span */
    parentSpanId?: string;
    /** Renderer/Daemon 透传的原生 W3C traceparent，供 CLI 在流式 chunk 中回传，使 renderer.stream_render 挂回 renderer.prompt.send */
    upstreamTraceparent?: string;
    /** 当前/最近一轮 Agent CLI producer span 的 canonical W3C traceparent。 */
    lastConversationTraceparent?: string;
    /** 与 upstreamTraceparent 同批校验通过的 W3C tracestate。 */
    upstreamTracestate?: string;
    /** 与 upstreamTraceparent 同批校验通过的 W3C baggage。 */
    upstreamBaggage?: string;
    /**
     * 发起本次请求的客户端（IDE / 端侧 / 调用方）随请求透传的、用于 `/v2/report` 遥测
     * 归属的公共字段。cloud agent 部署在云端、一个进程服务多个客户端，遥测公共字段必须是
     * **发起本次请求的那一端**的真实值，而非云端进程自己的进程级默认值（否则全归 `CLI`）。
     *
     * 随每次请求刷新（ACP 经 `_meta['codebuddy.ai']`；print/stream-json 经 HTTP body）。
     * 普通 CLI 不透传时为 undefined，遥测走进程级 `ClientInfoProvider` 兜底，行为不变。
     */
    telemetryClientInfo?: TelemetryClientInfo;
    /** Root span for current conversation request, used to extract B3 trace headers */
    conversationRequestRootSpan?: import('@genie/telemetry').Span;
    /**
     * 释放 tracing 重初始化闸门（见 trace/trace-reinit-gate.ts）。TraceStartHook 建
     * root span 时置入，TraceStopHook / 强制收尾旧 root 时调用一次（幂等）。genie#113158。
     */
    _traceTurnRelease?: () => void;
    messageId?: string;
    /**
     * @deprecated Hooks 的 `generation_id` 现直接取 `conversationRequestId`（Request ID），
     * 与 IDE `agent.requestId` 对齐；不再写入本字段。保留仅兼容旧调用方读取。
     */
    generationId?: string;
    requestOptions: {
        allowedTools?: string[];
        model?: string;
        headers?: Record<string, string>;
        /**
         * 调用方（如 workbuddy 端侧）随每次 prompt 透传、需要转发到 model gateway 的自定义
         * HTTP header。与 `headers`（trace/server，不受 custom-model 门控）刻意分开：本字段
         * **受 custom-model 门控**（第三方/自定义模型端点不下发），且每轮 set-or-clear，
         * 不会跨轮残留。来源 `_meta['codebuddy.ai'].customPassthroughHeaders`，经启动期前缀
         * 白名单（`CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES`，即安全边界）过滤后写入。
         */
        customPassthroughHeaders?: Record<string, string>;
        /**
         * 宿主为本会话内置模型请求提供的请求头（图灵盾设备令牌等），由 `/server` 库的
         * QueryOptions.internalModelRequestHeaders 每次 query 整体置换。与插件运行时的
         * internalModelRequestHeaders 同一门控与清理集：自定义模型端点不下发，
         * CODEBUDDY_SKIP_INTERNAL_HEADERS 时清理；只在驻留会话上，不进历史与存储。
         */
        internalModelRequestHeaders?: Record<string, string>;
        providerData?: Record<string, unknown>;
        pendingGrowthTelemetryReports?: Record<string, Record<string, unknown>>;
        /**
         * 调用方（如 workbuddy 前端）通过 ACP prompt `_meta['codebuddy.ai'].extraFieldsMeta`
         * 透传的一段不透明对象。本轮有效（每轮 prompt 设置 + finally 恢复），由 ModelProvider
         * 注入到本次请求最后一条 user message 的 `extra_fields._meta`，透传给 model gateway。
         *
         * 刻意不放进 `providerData`：providerData 会被 mergeRequestProviderData 平铺到请求体根，
         * 而 gateway 仅在 message 级读取 `extra_fields`，根级会被丢弃。
         */
        requestExtraFieldsMeta?: Record<string, unknown>;
    };
    permissionModeSubject: BehaviorSubject<PermissionMode>;
    backgroundTaskSubject: Subject<BackgroundTask>;
    /**
     * 进度文本，用于在 loading box 中显示自定义进度信息
     * 设置为 undefined 时恢复默认的随机 loading phrase
     */
    progressSubject: BehaviorSubject<string | undefined>;
    /**
     * Fine-grained execution phase tracking.
     * Used by loading UI to show what the agent is currently doing
     * (e.g. 'waiting for model', 'streaming', 'running Bash').
     */
    phaseSubject: BehaviorSubject<AgentPhaseInfo>;
    /**
     * Permission denials tracked during SDK mode
     * Used to populate permission_denials in result messages
     */
    permissionDenials?: Array<{
        tool_name: string;
        tool_use_id: string;
        tool_input: Record<string, unknown>;
    }>;
    /**
     * PreToolUse hook 结果缓存（per-call）
     * key 为 callId，在 needsApproval 阶段写入，executeToolWithHooks 阶段消费后清除
     * 用于避免重复执行 hooks，并在两阶段之间传递 modifiedInput
     */
    preToolUseHookResults?: Map<string, PreToolUseHookResult>;
    /**
     * 已提交副作用（如文件已写盘）的工具结果，key 为 callId。取消会让 SDK 丢弃
     * 这类结果；取消记账据此写入真实结果而不是 "Interrupted by user"（#142914）。
     * 读写统一经 `committed-tool-results.ts`。
     */
    committedToolResults?: Map<string, unknown>;
    /** Host 权限决策的 per-call 快照，供 Reviewer 和最终执行门判定普通/强制 ask。 */
    toolPermissionDecisionSnapshots?: Map<string, ToolPermissionResult>;
    /**
     * 缓存最近的 checkpoint, 这里主要存储 fileSnapshots 信息
     */
    checkpoint?: Checkpoint;
    /**
     * 对话链中最后一条消息 ID
     * 作为对话树的"当前指针"，每个新消息到达时更新
     * 用于追踪对话分支、构建历史链、支持多分支回退
     *
     * undefined: 表示历史对话还没有数据
     * string: 表示指向当前对话分支中最后一条数据，或者要回退到对话分支中的一条数据 ID
     */
    lastMessageId?: string;
    /**
     * 标记是否发生了对话回退操作
     * 当通过 checkpoint 回退对话时设为 true，防止 setCurrent 重新计算 lastMessageId 覆盖回退设置。
     * 一旦设置，session 的 lastMessageId 由 agent run pipeline 直接管理，不再通过 setCurrent 自动推进。
     */
    conversationReverted?: boolean;
    /**
     * 最后一条真实用户消息的 ID
     * 仅在 isRealUserMessageItem() 为 true 时更新，排除 skipRun、自定义消息等
     * 用于文件快照关联、记录用户操作边界，赋值给 FileHistorySnapshotItem.snapshot.messageId
     */
    lastUserMessageId?: string;
    /**
     * 指示当前会话历史是否包含压缩消息
     *
     * - true: 会话包含压缩历史，启用 logicalParentId 回溯
     * - false/undefined: 会话无压缩历史，仅使用 parentId
     */
    hasCompactedHistory?: boolean;
    /**
     * 指示是否正在执行上下文压缩
     * 运行时标志，仅存在于内存中，不会被持久化
     */
    isCompressing?: boolean;
    /**
     * 标记当前 session 处于"用户主动 cancel"的对端事件静默窗口。
     *
     * 用途:cancel 后 teammate 的 agent.run() 可能仍在跑(卡在 SendMessage 等待、
     * 不响应 abort 的工具等),持续 emit message chunk / tool_call / phase 事件。
     * 这些"残留活动"被 AcpTeamBridge 转发会让 desktop chatState 反复抖动 →
     * 取消按钮闪烁。本字段是 CLI 对对端的承诺:cancel 后不再报告 teammate 活动。
     *
     * - 设:`acp-view.ts` cancelEvent 订阅触发时
     * - 清:下一次 `executePrompt` 入口(cancel barrier 未命中)
     *
     * 运行时标志,仅存在于内存中,不会被持久化。
     */
    teamCancelled?: boolean;
    /**
     * lead cancel 代际计数:每次置 `teamCancelled = true` 时 +1(经
     * `SessionUtils.markTeamCancelled`),从不回退。
     *
     * 用途:区分"cancel 之前就已在途的 spawn"与"cancel 之后才派发的 spawn"。
     * 成员只在派发后又发生过 cancel 时才被 lead-cancel 屏障暂停,避免陈旧的
     * `teamCancelled` 误杀下一轮新派发的 worker。运行时字段,不持久化。
     */
    teamCancelEpoch?: number;
    /**
     * 上次压缩完成的时间戳（Date.now()）
     * 用于防止 compact 后立即重新触发：compact 后 getLatestUsage() 跳过 compact agent，
     * 回退到压缩前的 usage 数据（仍然很高），导致 shouldCompact 误判。
     * 冷却期内跳过自动 compact 检查，等待 continue 消息产生新的 usage 数据。
     * 运行时标志，仅存在于内存中，不会被持久化。
     */
    lastCompactTimestamp?: number;
    /**
     * 当前 request 中连续触发 EMERGENCY_AUTO (doMaxTokenCompaction) 的次数。
     * 用于防止单次用户请求中 compact → sendContinueMessage → compact 无限循环。
     * 达到上限（默认 5 次）后停止 compact 并中止当前 request。
     *
     * 重置时机（二者任一）：
     * 1. `SessionManager.addHistory` 收到外部新用户输入时，经 `beginExternalUserRequest`
     *    重置——所有入口（ACP / TUI / remote-control / remote-gateway / headless）共用；
     * 2. `compactAndSummarize` 入口处 compact 类型不是 EMERGENCY_AUTO。
     *
     * 运行时标志，仅存在于内存中，不会被持久化。
     */
    consecutiveMaxTokenCompactCount?: number;
    /**
     * 压缩前保存的最近一条用户消息，用于压缩恢复后生成带上下文的 continue 消息
     * 运行时标志，仅存在于内存中，不会被持久化
     */
    originalUserIntent?: string;
    structuredOutput?: any;
    /**
     * Hook-injected contexts
     */
    hookContexts?: {
        /**
         * Context from SessionStart hook to be injected into first user message
         */
        sessionStartContext?: string;
        /**
         * Promise that resolves when SessionStart hook execution finishes.
         * Used to avoid startup deadlocks while still ensuring first-turn context injection.
         */
        sessionStartReadyPromise?: Promise<void>;
        /**
         * Context from UserPromptSubmit hook to be injected into current user message
         */
        userPromptSubmitContext?: string;
        /**
         * Context from UserPromptExpansion hook (hookSpecificOutput.additionalContext),
         * to be injected alongside the expanded prompt (Claude Code parity: same
         * injection point as UserPromptSubmit — "alongside the submitted prompt").
         */
        userPromptExpansionContext?: string;
        /**
         * Context from PostToolUse hook to be injected after tool execution
         */
        postToolUseContext?: string;
        /**
         * Feedback from Stop hook (when exit code 2 is returned)
         * Indicates the hook wants to continue the conversation with this feedback
         */
        stopHookFeedback?: string;
        /**
         * Flag indicating Stop hook continuation is active.
         */
        stopHookActive?: boolean;
        /**
         * Feedback from SubagentStop hook (when exit code 2 is returned)
         */
        subagentStopHookFeedback?: string;
        /**
         * Additional instructions from PreCompact hook
         */
        preCompactInstructions?: string;
        /**
         * 直连 compact agent 的手动 `/compact` 已触发 PreCompact，等待在本次
         * compact run 成功收尾时触发一次 PostCompact。
         */
        manualCompactPostPending?: boolean;
        /**
         * Initial user message injected by SessionStart hook (hookSpecificOutput.initialUserMessage).
         * When present, cbc injects this as the first user prompt of the session.
         */
        sessionStartInitialUserMessage?: string;
        /**
         * Additional context contributed by a Setup hook (trigger=init).
         * Prepended alongside sessionStartContext in the first user prompt.
         */
        setupContext?: string;
        /**
         * Unified continue request from Stop hooks
         * Used by both external shell hooks and internal Hook providers
         */
        continueRequest?: {
            message: AgentInputItem;
            completionPromise?: Promise<void>;
        };
    };
    conditionalRules: {
        pendingTriggers: Set<string>;
        processedRules: Set<string>;
    };
    /**
     * 队列消息记录
     * 用于在请求之间持久化临时插入的队列消息
     * key: 前一个消息的 tool_call_id（优先）或 messageId
     * value: 插入的消息对象
     * 在session请求结束时由拦截器清理
     */
    queuedMessagesRecord?: Map<string, any>;
    /**
     * Result 到 AbortSignal 的映射
     * 用于在处理 interruptions 时获取对应 result 创建时的 abortSignal
     * 确保 compactAndSummarize 触发压缩时能正确取消对应的授权等待
     */
    resultAbortSignalMap: WeakMap<RunResult<any, any> | StreamedRunResult<any, any>, AbortSignal>;
    /**
     * Deferred for headless mode completion
     * Used to signal when the session has truly finished (no more continueRequest)
     * Only set in headless mode (outputFormat: 'json' | 'stream-json')
     */
    headlessCompletionDeferred?: Deferred<void>;
    /**
     * Tool permission context for session-level permission state
     * Contains rules, modes, and context for permission checking
     */
    toolPermissionContext: ToolPermissionContext;
    /**
     * Per-tool-call child spans for tracing
     * Maps callId to the open Span created in PreToolUse, ended in PostToolUse
     */
    _toolSpans?: Map<string, import('@genie/telemetry').Span>;
    /**
     * Per-tool-call start timestamps for Galileo duration metrics.
     * Maps callId to Date.now() at PreToolUse, consumed and deleted in PostToolUse.
     */
    _toolStartTimes?: Map<string, number>;
    /**
     * Galileo 视图层 step 计数器（每轮从 1 开始）。
     * 在 USER_PROMPT_SUBMIT 置 0，PreToolUse 每次 +1。
     */
    _galileoViewStepCounter?: number;
    /**
     * Galileo 视图层每次工具调用的 span 上下文。
     * key 为 callId，值为本次调用对应的 step/tool-call/execute span。
     */
    _galileoViewSpanContexts?: Map<string, {
        stepSpan: import('@genie/telemetry').Span;
        toolCallSpan: import('@genie/telemetry').Span;
        executeSpan: import('@genie/telemetry').Span;
    }>;
    /**
     * Interceptor completion gate.
     * Created synchronously in session-manager's resultSubject callback,
     * awaited by stream-json-view / llm-view before sending result.
     * If resolved with `true`, the result should be suppressed (interceptor started a retry).
     */
    interceptorGate?: InterceptorGate;
    /**
     * Per-session cache of sandbox escalation approvals.
     *
     * Populated when the user picks `allow_session` on a SandboxInterceptCard
     * and consulted by the sandbox Orchestrator on subsequent invocations to
     * skip the approval UI for the same (canonical command, cwd) key.
     *
     * Lifecycle: lazily created on first access; reset whenever the session is
     * replaced (e.g. `/clear`). Not persisted to disk.
     */
    sandboxApprovalStore?: import('../permission/sandbox-approval-store').SandboxApprovalStore;
    /**
     * Per-session cache for write/edit tool sandbox approvals.
     *
     * Populated only when the user selects `allow_session` on a sandbox
     * intercept raised before local Write/Edit/MultiEdit/NotebookEdit runs.
     * Keyed by normalized absolute path; not persisted.
     */
    sandboxWriteApprovalPaths?: Set<string>;
    /**
     * Per-session cache for Read tool sandbox approvals.
     *
     * Populated only when the user selects `allow_session` for a `no_access`
     * rule matched before a local or intercepted Read call. Keyed by normalized
     * absolute path; not persisted.
     */
    sandboxReadApprovalPaths?: Set<string>;
    /** Hosts approved for the remainder of this session. */
    sandboxNetworkApprovalHosts?: Set<string>;
    /** One-time WebFetch approvals, keyed by tool call ID and bound to the approved host. */
    sandboxNetworkApprovalToolCalls?: Map<string, string>;
    /**
     * Per-session set of absolute memory file paths already surfaced via
     * MemoryContextInterceptor's AI relevance selection. Passed to
     * `MemoryRelevanceService.selectRelevantMemories` as the
     * `alreadySurfaced` pre-filter so the same large memory isn't injected
     * into the Messages region multiple turns in a row. Matches Claude Code's
     * `findRelevantMemories` contract.
     *
     * Lifecycle: lazily created on first access; reset when the session is
     * replaced (e.g. `/clear`). Not persisted.
     */
    memoriesSurfacedInSession?: Set<string>;
    /**
     * Purpose tag for the current model request.
     * Used to classify different types of LLM calls (e.g. 'conversation', 'summary',
     * 'webfetch', 'subagent:explore') and sent as the X-Agent-Purpose HTTP header.
     * Consumed downstream by Langfuse for trace tagging and analytics.
     */
    agentPurpose?: string;
}
export interface CombineEventMeta {
    /**
     * When the event originates from a subagent (Agent tool), this is the parent tool use id
     * (Agent tool callId) in the main session.
     */
    parentToolUseId?: string;
    subagent?: SubagentEventReference;
    subagentMessageId?: string;
    subagentRequestId?: string;
    subagentRootRequestId?: string;
    /**
     * Process-local child Session reference used to derive that child's ACP
     * usage snapshot before AgentTask releases it. Never persisted or projected
     * directly onto the wire.
     */
    subagentSession?: Session;
}
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export interface SubagentEventReference {
    version: 1;
    sessionId: string;
}
/** Cumulative token counters attached to a terminal child Session state. */
export interface SubagentTokenUsageSnapshot {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    thoughtTokens?: number;
    cachedReadTokens?: number;
    cachedWriteTokens?: number;
}
export interface SubagentLifecycleSnapshot extends SubagentEventReference {
    rootSessionId: string;
    parentSessionId: string;
    parentToolCallId: string;
    conversationRequestId: string;
    rootRequestId: string;
    role: string;
    description: string;
    mode: 'attached' | 'background';
    status: SubagentStatus;
    createdAt: number;
    updatedAt: number;
    error?: string;
    /** Present on terminal snapshots when the child produced reliable usage. */
    usage?: SubagentTokenUsageSnapshot;
}
export interface SubagentInvocationRecord {
    version: 1;
    invocationId: string;
    afterId: string | null;
    lastId: string | null;
    lifecycle: SubagentLifecycleSnapshot;
}
export type SubagentLifecycleDescriptor = Omit<SubagentLifecycleSnapshot, 'status' | 'updatedAt' | 'usage'>;
export type CombineEvent = (AgentInputItemEvent | AgentSdkStreamEvent | ModelRawResponseEvent | ResultEndEvent | InterruptResultEvent | NoticeEvent | SubagentStatusEvent | CompactionLifecycleEvent | TerminalEvent) & CombineEventMeta;
export interface CompactionLifecycleEvent {
    type: 'compaction';
    data: {
        compactionId: string;
        status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
        trigger: 'manual' | 'auto';
        /** Source category, shared with the persisted compact boundary. */
        compactType?: string;
        error?: string;
        timestamp: number;
    };
}
export interface SubagentStatusEvent {
    type: 'subagent_status';
    data: SubagentLifecycleSnapshot;
}
/** Original SDK stream payload, observed by the existing single stream consumer. */
export interface AgentSdkStreamEvent {
    type: 'sdk';
    data: import('../../../cbc-shared/node/index.js').RunStreamEvent;
}
export interface AgentInputItemEvent {
    type: 'input';
    data: AgentInputItem;
}
export interface ModelRawResponseEvent {
    type: 'model';
    data: ResponseStreamEvent;
}
export interface ResultEndEvent {
    type: 'result';
    data: RunResult<any, any> | StreamedRunResult<any, any> | undefined;
    /** Cached snapshot of whether interruptions existed at the time the event was created */
    hasInterruptions?: boolean;
}
export interface InterruptResultEvent {
    type: 'interrupt_result';
    data: StreamedRunResult<any, any>;
}
/**
 * 进度/存活类通知，**不携带任何模型正文**（不进入历史、不影响 assistant/thinking
 * block 状态机）。当前唯一用例：模型持续吐 reasoning 但迟迟不产出实质内容
 * （text/tool_calls/refusal）这一特定场景下，由 ModelProvider 的流监控按 env 间隔
 * 周期性推送，供调用方（stream-json / ACP）把「长推理」与「真卡死」区分开，并喂活
 * sandbox-proxy 的存活水位。视图层把它翻译成各自 surface 的既有存活帧（如 stream-json
 * 的 KeepaliveMessage）；不认识该 type 的消费者自然忽略（纯 additive）。
 */
export interface NoticeEvent {
    type: 'notice';
    notice: SessionNotice;
}
export interface SessionNotice {
    /** 通知判别子。当前取值：'reasoning_in_progress'。 */
    kind: 'reasoning_in_progress';
    /** 距当前模型请求发起的毫秒数。 */
    elapsedMs?: number;
    /** 当前模型流已接收的原始 SSE chunk 数。 */
    chunkCount?: number;
    /** 当前模型流已接收的原始字节数。 */
    bytes?: number;
}
export interface InputText {
    text: string;
    type: 'input_text';
}
export interface SessionOptions {
    /** Host workspace for local transcript reads/writes; omitted uses the CLI working directory. */
    cwd?: string;
    /** Set by the native TUI loopback request; ACP sessions set this to false. */
    interactive?: boolean;
    debug?: boolean | string;
    debugToStderr?: boolean;
    verbose?: boolean;
    print?: boolean;
    /** Host Bash output preference; omitted preserves the CLI's PTY selection. */
    usePty?: boolean;
    outputFormat?: 'text' | 'json' | 'stream-json';
    inputFormat?: 'text' | 'stream-json';
    /** Whether to persist the session transcript. Defaults to true; false keeps history in memory only. */
    sessionPersistence?: boolean;
    /** Per-session base-prompt override (server surface); applied on the run-scoped agent clone. */
    systemPrompt?: string;
    /** Per-session append to the base prompt; composes with systemPrompt or the default. */
    appendSystemPrompt?: string;
    dangerouslySkipPermissions?: boolean;
    /** 与 `--permission-mode` 同一批值（CLI_PROCESS_PERMISSION_MODES）；枚举全集见 PermissionMode。 */
    permissionMode?: 'acceptEdits' | 'bypassPermissions' | 'default' | 'plan' | 'dontAsk' | 'auto' | 'fullAccess';
    /** Permission mode before entering plan mode (set by Desktop when session starts in plan) */
    permissionModeBeforePlan?: string;
    /** Default permission mode for subagents/teammates. Overrides mode inheritance from main session. */
    subagentPermissionMode?: string;
    allowedTools?: string[];
    disallowedTools?: string[];
    /** Ask rules from the server `QueryOptions.askTools`; same grammar as allowedTools. */
    askTools?: string[];
    tools?: string;
    /**
     * 会话级 defer overlay 的纯数据快照：把 `tools` 字段里的
     * `Defer(...)` / `NoDefer(...)` 修饰解析后挂到这里，覆盖 product/MCP 配置
     * 的默认 defer 状态（NoDefer 优先于 Defer）。
     *
     * 之所以存 snapshot 而不是 ToolDeferOverlay 实例：SessionOptions 会经
     * JSON 序列化（ACP / `--serve` 模式），class 实例的方法跨进程边界会丢失。
     * 消费方在使用前用 `ToolDeferOverlay.fromSnapshot(snapshot)` 或 `ToolDeferOverlay.merge(...)` 实例化即可。
     *
     * 由 SessionMiddleware 负责填充；为 undefined 或 EMPTY 时，
     * defer 判定与原行为完全一致。
     */
    toolDeferOverlay?: ToolDeferOverlaySnapshot;
    mcpConfig?: string;
    continue?: boolean;
    continued?: boolean;
    resume?: string;
    /**
     * 对齐 Claude Code `--resume-session-at <message id>`：resume 加载出完整历史
     * 后，把history 截断到该message id（含）为止（slice(0, index+1)）。
     * 由 CLI 透传，SessionMiddleware 在 admission拿到完整历史后应用截断。
     * 找不到该 id 时抛 SessionResumeAtNotFoundError（对齐 Claude 的报错退出）。
     */
    resumeSessionAt?: string;
    model?: string;
    /**
     * 会话级 outputStyle 快照（Issue #83229）：SessionManager.create() 时从
     * settings.json 读一次填入，本 session 后续 run 只读它、不再读 settings.get('outputStyle')。
     * 修改 settings.json 不会影响当前会话，重启进程或 /clear（新建 session）后才应用新值。
     */
    outputStyle?: string;
    fallbackModel?: string;
    textToImageModel?: string;
    imageToImageModel?: string;
    textToVideoModel?: string;
    imageToVideoModel?: string;
    addDir?: string[];
    ide?: boolean;
    strictMcpConfig?: boolean;
    sessionId?: string;
    includePartialMessages?: boolean;
    /**
     * Direct-stdout delivery (print + stream-json only): set by the in-process
     * CLI client. StreamJsonView writes events straight to stdout instead of
     * the HTTP response, and settles PrintDeliveryLifecycle[deliveryId] when
     * the terminal result has been emitted — process exit is driven by that
     * settle, not by the response socket. Remote clients never set these.
     */
    directDelivery?: boolean;
    /** Correlates one direct-delivery request with its lifecycle settle. */
    deliveryId?: string;
    forkSession?: boolean;
    replayUserMessages?: boolean;
    acp?: boolean;
    /** The host admits runs through its own queue; kernel wrap-up must not start an unowned drain. */
    hostManagedQueue?: boolean;
    /** Pin model tool declarations per run; invocation still checks current availability and permissions. */
    freezeToolsDuringRun?: boolean;
    acpTransport?: 'stdio' | 'streamable-http';
    /**
     * 当前进程里这个 session 是 Web UI ACP 连接拉起来的。
     * 只活在内存，不进 jsonl；由 initialize `clientInfo.name=codebuddy-web-ui` 打标。
     * `/goal` drain、回放 snapshot 靠它，避免 WorkBuddy `--acp` 走到同一套新语义。
     */
    webUiAcp?: boolean;
    /**
     * 最近一次真正开始执行的人工输入来自哪个界面，只活在内存。`webUiAcp` 记的是"被 Web UI
     * 连过"，会一直留着；同一会话之后改在终端里聊时，Web 专属能力要看这个值收回。
     */
    lastHumanInputSurface?: HumanInputSurface;
    jsonSchema?: string;
    /** SDK declared capabilities */
    sdkCapabilities?: SdkCapabilities;
    /** Remote Control mode: true for AgentOS mode, string for specific client type (e.g. 'wecom') */
    remoteControl?: boolean | string;
    /** Enable specific channels (comma-separated: plugin:name@marketplace or server:configName) */
    channels?: string;
    /** Bypass allowlist for specific development channels (requires confirmation) */
    dangerouslyLoadDevelopmentChannels?: string;
    /** Load plugins from local directories (for development/testing) */
    pluginDir?: string[];
}
export interface SessionFactory {
    create(options?: Partial<Session>): Promise<Session>;
}
/**
 * 传给 SessionManager/SessionStore.get() 的选项。
 *
 * 默认情况下，session 反序列化会从尾部截断（仅读最近 ~1000 条历史），
 * 目的是保证正常运行时（会话续聊、模型上下文装配）的性能与内存占用。
 * 展示型场景（如历史回放给前端完整聊天视图）可以通过 `historyLimit` 放大上限。
 */
export interface SessionGetOptions {
    /**
     * 从 jsonl 尾部加载的历史 item 数上限。
     *
     * - 未传：沿用默认 1000（服务于续聊、checkpoint、模型上下文等场景）。
     * - 显式传值：按该值截断（如展示型 replay 传 10000）。
     *
     * 注意：这是 item 数，不是消息数。1 条 user/assistant 消息对应 1 个 item，
     * 但 tool_call/reasoning/snapshot 等也各自占 1 个 item。超大 session 中
     * 10000 个 item 约对应几百条聊天气泡。
     */
    historyLimit?: number;
    /** Propagate I/O or corruption instead of treating the record as absent. */
    throwOnError?: boolean;
    /**
     * Preferred cwd for locating the session jsonl.
     */
    cwd?: string;
    /** Exact parent directory for a nested subagent transcript. */
    parentSessionId?: string;
}
interface SessionForkMutationBase {
    additionalDirectories?: string[];
    cwd: string;
}
export type SessionForkMutationOptions = SessionForkMutationBase & ({
    history: AgentInputItem[];
    atMessageId?: never;
} | {
    history?: never;
    atMessageId: string | null;
});
export interface SessionForkPointsOptions {
    cwd: string;
    limit?: number;
    beforeMessageId?: string;
}
export interface SessionForkPoint {
    id: string;
    role: 'user' | 'assistant';
    preview: string;
    timestamp?: number;
}
export interface SessionForkPointsPage {
    items: SessionForkPoint[];
    hasMore: boolean;
    nextBeforeMessageId: string | null;
}
export interface SessionRewindMutationOptions {
    cwd: string;
    headMessageId: string | undefined;
}
/**
 * model override 的意图来源：决定该值是否等价于「用户显式选择」。
 * - 'user'：/model 命令、ACP set_model、SDK 控制信号等用户动作；
 * - 'declared'：主 Agent 声明模型（declaredModel）联动写入；
 * - 'materialized'：Web UI 会话装配期钉住的兜底解析值（非用户意图）。
 */
export type OverrideModelSource = 'user' | 'declared' | 'materialized';
export interface SessionManager {
    getCurrent(): Session;
    setCurrent(session: Session): void;
    getMostRecent(): Promise<Session | undefined>;
    create(options?: Partial<Session>, needHandleRunResult?: boolean, parentSession?: Session): Promise<Session>;
    /**
     * Fill missing session-scoped settings after a SessionStore restore.
     *
     * SessionStore intentionally does not persist runtime options, so resume
     * admission must snapshot the current startup settings once before the
     * request is merged. Existing values (for example an explicit --model)
     * are never overwritten.
     */
    seedStartupSettingsSnapshot(session: Session): Promise<void>;
    /**
     * Canonical entry point for emitting `SessionStart`. All call sites
     * (middleware, ACP view, /clear, /fork, /compact) must go through here so
     * the trigger stays transport-agnostic:
     *   - `startup` / `resume` are deduped per Session object (no double-emit
     *     across middleware + view, no re-emit across interactive turns).
     *   - `clear` / `compact` always emit — explicit caller-driven events.
     * Downstream interceptors await `hookContexts.sessionStartReadyPromise`
     * before injecting `additionalContext`.
     */
    emitSessionStart(session: Session, source: SessionStartSource): Promise<void>;
    /**
     * Record a mod-plugin `$.ui.log` line as a user-visible message on the
     * session transcript (mirrors `recordHookBlockedMessage` — same
     * inputSubject / combineSubject / sessionStore path — but leaves
     * `lastMessageId` and `parentId` untouched because mod logs are
     * decorative and must not become anchors on the replay branch).
     *
     * @param session target session (host resolves current session and passes it in)
     * @param text already prefixed as `<plugin>: <text>` by the host bridge
     * @param plugin the calling mod's name (`origin.plugin`), for provider metadata
     */
    recordModLogMessage(session: Session, text: string, plugin: string): Promise<void>;
    /** 轮内插入仍保留用户身份，但不能刷新安全策略与检测额度。 */
    addHistory(session: Session, input: string | AgentInputItem[], continueTurn?: boolean): Promise<void>;
    /** 回写在工具结果落盘后才完成的安全审查结论。 */
    syncSecurityReviewConclusions?(session: Session): Promise<void>;
    save(session: Session): Promise<void>;
    /** Initialize an immutable full snapshot for a new fork; target must be absent or empty. */
    initializeForkHistory(session: Session): Promise<void>;
    get(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    getAll(): Promise<Session[]>;
    /**
     * Initialize the run-result handler (resultSubject subscriber) for a session.
     * Must be called for resumed sessions that were loaded via get() rather than
     * create(), so that stream data is properly processed (addHistory, agent_end, etc.).
     */
    initRunResultHandler(session: Session): void;
    /**
     * 获取所有项目的 sessions（跨工作目录）
     * @param options.sinceMs 可选，只返回 mtimeMs >= sinceMs 的 session（文件级预过滤，避免反序列化所有旧 session）
     */
    getAllAcrossProjects(options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    /**
     * 根据工作目录查询 sessions
     * @param cwd 工作目录参数：
     *   - undefined/null: 返回当前工作目录的 sessions
     *   - '*': 返回所有项目的 sessions（跨工作目录）
     *   - string: 返回指定工作目录的 sessions
     * @param options.sinceMs 可选，只返回 mtimeMs >= sinceMs 的 session
     */
    getAllByWorkdir(cwd?: string | null, options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    remove(id: string): Promise<void>;
    removeAcrossProjects(id: string): Promise<void>;
    /**
     * 释放一个已完成 subagent session 占用的所有**常驻内存**注册表引用，但**不删除
     * 磁盘 jsonl**（subagent 仍需支持 resume）。
     *
     * 与 `remove()` 的区别：`remove()` 会 `fs.unlink` 掉 session 文件，只适用于
     * 用户主动删除会话；subagent 跑完只是不再活跃，磁盘记录要保留。
     *
     * 背景（OOM 根因）：每个 subagent 经 `create()` 创建时被注册进
     * `resultSubscriptions` / `IdleQueueDrainService` / `TeamInboxDispatchService` /
     * `InterruptionService`，这些注册表用 sessionId 索引并**强引用整个 Session 对象
     * （含 history）**。`AgentTask.cleanup()` 之前只置空自己的局部引用，这些注册表
     * 从不注销，导致长跑主 session 反复 spawn 的 subagent（实测 337 个）全部常驻内存
     * → heap 8.5h 从 1.1GB 爬到撞 2GB 上限 OOM。
     *
     * 幂等：未注册的 sessionId 为 no-op。
     *
     * @param target 传 Session 对象时，索引键与身份校验同源——只有注册表当前持有
     * 的正是这个对象才释放，复用同一 sessionId 的后继对象不会被误清。只拿得到
     * id 的调用方（RPC、`remove(id)`）传字符串，此时不做身份校验。
     */
    releaseInMemory(target: string | Session): void;
    /**
     * 该 sessionId 是否已在本进程通过 get() 加载过（且尚未 remove()/releaseInMemory()）。
     *
     * 用于 SessionHistoryCleanService 等只读安全检查：mtime 判断的"过期"不能覆盖
     * "用户刚恢复、尚未发新消息"的会话（此时既不会更新 mtime，也没有 idleTimer/
     * resultSubscription 等其它活跃标记）。不代表该 session 正在运行 agent 任务，
     * 只表示曾被加载且未释放。
     */
    isLoadedInMemory(id: string): boolean;
    /** The Session object that owns the live result subscription for this id, if any. */
    getWiredInMemory?(id: string): Session | undefined;
    rename(session: Session, name: string): Promise<void>;
    sessionSubject: BehaviorSubject<Session | undefined>;
    run<R>(session: Session, callback: (...args: any[]) => R): R;
    /**
     * 在 callback 的整个 async 执行链里跳过 addHistory。
     * 用于后台 agent（如 memory extraction）不污染主 session 历史记录，同时不影响并行的主 agent。
     */
    runWithoutHistory<R>(callback: () => R): R;
    /**
     * 设置 session 的 permissionMode 覆盖值（来自 SDK control signal）
     * 这些值会覆盖 CLI 参数和配置文件的设置
     */
    setOverridePermissionMode(sessionId: string, mode: PermissionMode): void;
    getOverridePermissionMode(sessionId: string): PermissionMode | undefined;
    /** 撤销覆盖值，让后续 updatePermissionMode 回到 CLI 参数与 settings 的解析链。 */
    clearOverridePermissionMode(sessionId: string): void;
    /**
     * 设置 session 的 model 覆盖值。source 记录意图来源，供「是否用户显式选择」判定：
     * - 'user'（默认）：/model 命令、ACP set_model、SDK 控制信号等用户动作；
     * - 'declared'：主 Agent 声明模型（declaredModel）联动写入；
     * - 'materialized'：Web UI 会话装配期钉住的兜底解析值（非用户意图）。
     */
    setOverrideModel(sessionId: string, model: string, source?: OverrideModelSource): void;
    getOverrideModel(sessionId: string): string | undefined;
    getOverrideModelSource(sessionId: string): OverrideModelSource | undefined;
    clearOverrideModel(sessionId: string): void;
    /**
     * 设置会话运行时模型：同步写 session.options.model + requestOptions.model + override map。
     *
     * 拦截器/ModelUtils 的权威优先级是 requestOptions.model > options.model > agent 默认；
     * --model 启动参数固化在 options.model，仅写 settings/cli 无法覆盖它。override map
     * 供 applyOverrideModel 每轮重建 requestOptions（Issue #82146）。/model 命令与模型面板
     * 共用此入口；ACP set_model 经 applyRuntimeSessionModel 调用。
     * 切换前模型不在这里记录，压缩路径从会话历史里最近一次用量推导。
     */
    setRuntimeModel(session: Session | undefined, modelId: string, source?: OverrideModelSource): void;
    /**
     * 设置会话运行时 outputStyle：同步写 session.options.outputStyle。
     *
     * outputStyle 每轮 run 都从 session 读（无 requestOptions / override map 的分离需求），
     * 所以只需写 options。样式面板在会话内切换立即生效，改 settings.json 不影响当前会话
     * （新期望，Issue #83229）；下次 /clear 或重启 session 会读回 settings。
     */
    setRuntimeOutputStyle(session: Session | undefined, style: string): void;
    /**
     * 设置 session 的思考能力覆盖值（Issue #12554：会话级 thinking override）。
     *
     * 与 setOverrideModel 同样，这是"按 sessionId 隔离的运行时配置"，
     * 不会污染用户的全局 settings.json。
     * 来源：ACP setSessionConfigOption('thought_level', ...) / prompt _meta
     *
     * @param sessionId 会话 ID
     * @param value     null = 清空 override（恢复使用全局 settings）；
     *                  对象 = 设置本会话的 thinking 配置；
     *                  thinkingEnabled=false 必须同时清空 reasoningEffort，
     *                  避免上一轮 high/max 残留导致"以为关了实际没关"
     */
    setOverrideThinking(sessionId: string, value: {
        thinkingEnabled?: boolean;
        reasoningEffort?: ReasoningEffortLevel;
        maxThinkingTokens?: number;
    } | null): void;
    getOverrideThinking(sessionId: string): {
        thinkingEnabled?: boolean;
        reasoningEffort?: ReasoningEffortLevel;
        maxThinkingTokens?: number;
    } | undefined;
    /**
     * 设置 / 读取 session 的上下文预算档位覆盖（Issue #57413：200K / 1M 档位选择）。
     *
     * 与 setOverrideThinking 同族的 control-signal：按 sessionId 隔离、仅进程内有效、
     * **不落盘**，不污染全局 settings.json。
     * 来源：ACP setSessionConfigOption('context_window', ...)。
     *
     * 消费方经 `resolveEffectiveContextBudget` 换算成 usage 分母与压缩阈值；
     * 该 helper 对不属于当前模型 supportedLengths 的非法值 fail-closed。
     *
     * @param value null = 清空 override（回落产品默认档）；正整数 = 本会话选中的档位（token 数）
     */
    setOverrideContextWindow(sessionId: string, value: number | null): void;
    getOverrideContextWindow(sessionId: string): number | undefined;
    /**
     * Wait for all pending addHistory operations on this session to complete.
     * Useful when callers fire-and-forget addHistory and we need to ensure
     * all combineSubject events have been emitted before proceeding.
     */
    flushHistory(session: Session): Promise<void>;
    /** Persist a non-conversation fact before exposing it in memory; no input hooks or echo. */
    /** Commit a custom fact or context boundary before exposing it in memory. */
    appendHistoryFact(session: Session, item: AgentInputItem): Promise<void>;
}
/**
 * Cumulative transcript persistence counters (issue #119545 埋点建议).
 * A best-effort side channel, so every reader must treat the numbers as a
 * snapshot that may be sampled at any moment.
 */
export interface TranscriptPersistenceMetrics {
    /** In-band retry attempts consumed. */
    retries: number;
    /** Batches that only landed because of a retry. */
    retrySucceeded: number;
    /** Batches given up on after the retry budget. */
    abandonedBatches: number;
    /** Lines lost with those batches. */
    abandonedLines: number;
}
export interface SessionStore {
    getSessionFilePath(id: string, parentSessionId?: string, cwd?: string): string;
    /**
     * Transcript persistence counters, when the implementation keeps any.
     * Optional so in-memory and host-delegating stores do not have to fake it.
     * Exposed so callers that observe a degradation can log the counters from
     * their own call site: the store's own abandon audit line is best-effort
     * and a lost line would otherwise take the only copy of the numbers.
     */
    transcriptPersistenceMetrics?(): Readonly<TranscriptPersistenceMetrics>;
    get(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    getAcrossProjects(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    save(session: Session, cwd?: string): Promise<void>;
    remove(id: string): Promise<void>;
    removeAcrossProjects(id: string): Promise<void>;
    getAll(): Promise<Session[]>;
    /**
     * 获取所有项目的 sessions（跨工作目录）
     * 遍历 ~/.codebuddy/projects/ 下所有子目录
     * @param options.sinceMs 可选，只返回 mtimeMs >= sinceMs 的 session（文件级预过滤）
     */
    getAllAcrossProjects(options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    /**
     * 根据工作目录查询 sessions
     * @param cwd 工作目录参数：
     *   - undefined/null: 返回当前工作目录的 sessions
     *   - '*': 返回所有项目的 sessions（跨工作目录）
     *   - string: 返回指定工作目录的 sessions
     * @param options.sinceMs 可选，只返回 mtimeMs >= sinceMs 的 session
     */
    getAllByWorkdir(cwd?: string | null, options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    getMostRecent(): Promise<Session | undefined>;
    appendHistory(id: string, input: AgentInputItem[], parentSessionId?: string, session?: Session, cwd?: string, options?: {
        required?: boolean;
    }): Promise<void>;
    /** Initialize an immutable full snapshot for a new fork; target must be absent or empty. */
    initializeForkHistory(session: Session): Promise<void>;
    sessionKeyFor?(id: string, parentSessionId?: string): SessionKey;
    listLanes?(key: SessionKey): Promise<LanePointer[]>;
    getLane?(key: SessionKey, lane?: Lane): Promise<string | null>;
    moveLane?(key: SessionKey, lane: Lane, to: string | null): Promise<void>;
    loadLane?(key: SessionKey, lane?: Lane): Promise<SessionStoreEntry[]>;
    /**
     * Atomic fact-append + lane-move (issue #59319). See
     * session-store-contract.ts for the full contract.
     */
    appendFactAndMoveLane?(key: SessionKey, entries: SessionStoreEntry[], lane: Lane, to: string | null, options?: {
        persistLocal?: boolean;
    }): Promise<void>;
    saveHistory(session: Session, cwd?: string): Promise<void>;
    forkSession(source: Session, options: SessionForkMutationOptions): Promise<Session>;
    listForkPoints?(source: Session, options: SessionForkPointsOptions): Promise<SessionForkPointsPage>;
    rewindSession(source: Session, options: SessionRewindMutationOptions): Promise<void>;
}
export interface SessionHookManager {
    executeUserPromptSubmitHooks(session: Session, items: AgentInputItem[]): Promise<void>;
    executeSessionStartHooks(session: Session, source: SessionStartSource): Promise<void>;
    executeSessionEndHooks(session: Session, reason: SessionEndReason): Promise<void>;
    executeStopHooks(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any>, options?: {
        stopHookActive?: boolean;
        stopReason?: FinalStopReason;
    }): Promise<void>;
    executeSubagentStopHooks(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any>): Promise<void>;
    executeSubagentStartHooks(session: Session): Promise<void>;
    executeStopFailureHooks(session: Session, error: unknown): Promise<void>;
    executePreCompactHooks(session: Session, trigger: 'manual' | 'auto', customInstructions?: string): Promise<string | undefined>;
    executePostCompactHooks(session: Session, trigger: 'manual' | 'auto', compactSummary?: string): Promise<void>;
    executeNotificationHooks(session: Session | undefined, message: string, notificationType?: NotificationType): Promise<void>;
    /**
     * PermissionRequest (before a tool permission prompt).
     * Returns the hook-specified decision override, if any.
     */
    executePermissionRequestHooks(session: Session, toolName: string, toolInput: Record<string, any>, permissionSuggestions?: unknown, callId?: string): Promise<{
        decision?: {
            behavior: 'allow' | 'deny';
            updatedInput?: Record<string, any>;
            updatedPermissions?: unknown;
            message?: string;
            interrupt?: boolean;
        };
    }>;
    /**
     * PermissionDenied (after a permission has been refused).
     * Returns whether the hook requests a retry.
     */
    executePermissionDeniedHooks(session: Session, toolName: string, toolInput: Record<string, any>, reason: string, callId?: string): Promise<{
        retry?: boolean;
    }>;
    /**
     * Elicitation (before cbc shows an MCP elicitation prompt to the user).
     * Returns the hook-specified auto-response, if any.
     */
    executeElicitationHooks(session: Session, payload: {
        mcpServerName: string;
        message: string;
        mode?: 'form' | 'url';
        url?: string;
        elicitationId?: string;
        requestedSchema?: unknown;
    }): Promise<{
        action?: 'accept' | 'decline' | 'cancel';
        content?: unknown;
    }>;
    /**
     * ElicitationResult (after an MCP elicitation has resolved). Observe-only.
     */
    executeElicitationResultHooks(session: Session, payload: {
        mcpServerName: string;
        elicitationId?: string;
        mode?: 'form' | 'url';
        action: 'accept' | 'decline' | 'cancel';
        content?: unknown;
    }): Promise<void>;
    /**
     * TaskCreated (observe-only). Fired when a task enters the task store.
     */
    executeTaskCreatedHooks(session: Session, payload: {
        taskId: string;
        subject: string;
        description?: string;
        teammateName?: string;
        teamName?: string;
    }): Promise<void>;
    /**
     * TaskCompleted (observe-only). Fired when a task transitions to completed.
     */
    executeTaskCompletedHooks(session: Session, payload: {
        taskId: string;
        subject: string;
        description?: string;
        teammateName?: string;
        teamName?: string;
    }): Promise<void>;
    /**
     * TeammateIdle (observe-only, debounced). Fired when a teammate becomes idle.
     */
    executeTeammateIdleHooks(session: Session, payload: {
        teammateName: string;
        teamName: string;
    }): Promise<void>;
    /**
     * Setup (startup / maintenance). Returns the additionalContext the hook
     * injected into session.hookContexts, if any.
     */
    executeSetupHooks(session: Session, trigger: 'init' | 'maintenance'): Promise<void>;
    /**
     * FileChanged (observe-only). Fired when a path registered via
     * SessionStart/Setup hookSpecificOutput.watchPaths changes on disk.
     */
    executeFileChangedHooks(session: Session, payload: {
        filePath: string;
        event: 'change' | 'add' | 'unlink';
    }): Promise<void>;
    /**
     * CwdChanged (observe-only). Fired after Bash/PowerShell tools when
     * process.cwd() differs from the previously recorded value.
     */
    executeCwdChangedHooks(session: Session, payload: {
        oldCwd: string;
        newCwd: string;
    }): Promise<void>;
    /**
     * FinalStop (internal-only). Fired when the current run/turn reaches a
     * final terminal state and will not continue via the current Stop hook.
     * Does NOT support continueRequest.
     */
    executeFinalStopHooks(session: Session, reason?: FinalStopReason, internalContext?: Pick<InternalHookContext, 'interceptorGate'>): Promise<void>;
    /**
     * UserPromptExpansion — Claude Code 官方事件（非 cbc 专属扩展）：任何用户输入的
     * 命令/skill 在展开成 prompt、送进模型之前统一从这里触发，可阻断展开。适用于
     * skill、自定义命令、Dynamic Workflow、MCP prompt 等一切"输入即展开"的路径，
     * 不是只服务某一个具体调用方（如统一资产门控）。
     */
    executeUserPromptExpansionHooks(session: Session, payload: {
        /** Claude Code spec: 'slash_command' for skill/custom commands, 'mcp_prompt' for MCP prompts. */
        expansionType: 'slash_command' | 'mcp_prompt' | string;
        commandName: string;
        /** Claude Code spec: required field (empty string when no args), always sent. */
        commandArgs: string;
        /** e.g. Skill.source / Command.scope ('project' | 'user' | 'plugin' | 'mcp' | ...). */
        commandSource?: string;
        /** Claude Code spec: required field — raw, pre-expansion prompt text as typed by the user. */
        prompt: string;
    }): Promise<{
        allowed: boolean;
        message?: string;
    }>;
}
export interface RunItemProcessor {
    process(runItem: RunItem): Promise<void>;
}
/**
 * 优先级，大->小执行
 */
export declare enum AgentInputItemProcessorPriority {
    Default = 10,
    ParentIdLinkage = 9,
    FunctionCall = 8,
    FunctionCallResult = 7,
    SensitiveHistoryAdmission = 6.5,
    UsageProcessor = 6,
    Telemetry = 5,
    ExitPlanMode = 4,
    ToolContentAdmission = 3
}
export interface AgentInputItemProcessor {
    priority: AgentInputItemProcessorPriority;
    process(runItem: AgentInputItem, session: Session): Promise<void>;
}
/**
 * 中断队列中的排队项
 * 用于 InterruptionService 内部管理并发中断的 FIFO 队列
 */
export interface QueuedInterruption {
    item: RunToolApprovalItem;
    session: Session;
    deferred: Deferred<void>;
    teamContext?: {
        memberName: string;
        color?: string;
    };
}
/**
 * 权限审批全局真相源的视图对象
 *
 * 用于 TUI/UI 层订阅 InterruptionService.pending$ 时拿到队头项的完整上下文。
 * 避免既有的"哪个 session 持有 interruptionSubject"语义不一致（多 agent 并发时
 * 基于 parentIdToMainSession 的 findMainSession 解析会在注册竞态下 fallback
 * 到 sourceSession 自己，导致弹窗投递到非 TUI 绑定的 session 上）。
 *
 * 这是 `方案一：权限弹窗统一数据源` 的核心载体：
 * - enqueue/showHead/updateHeadQueueInfo/dequeue/cancel 任一写点都必须同步 next() 到
 *   InterruptionService.pending$，保证 UI 端只看这一个数据源即可反映真实队列状态。
 * - 保留 Session.interruptionSubject 作为 ACP 广播与遗留订阅者的兼容位；
 *   TUI 的 ToolCallApprovalPanel 已切到 pending$ 订阅，不再受 session 投递错位影响。
 */
export interface PendingApprovalView {
    item: RunToolApprovalItem;
    /** 发起审批的 source session id（通常是子 agent / teammate 的 session id） */
    sourceSessionId: string;
    /** 入队的 mainSession id（等于 findMainSession 的解析结果） */
    mainSessionId: string;
    /** Team 成员上下文（仅 team member 发起时存在） */
    teamContext?: {
        memberName: string;
        color?: string;
    };
    /** 当前项在队列中的位置（1-based，队头固定为 1） */
    queuePosition: number;
    /** 队列总长度 */
    queueTotal: number;
}
/** What the model reads for a call that an inline approval did not let run. */
export interface InlineToolRejection {
    /** The call's tool result. */
    content: string;
    /** What the call's row shows. */
    error: string;
    /** The run ends after this step without asking the model again. */
    terminal: boolean;
}
export interface InterruptionService {
    /** Host middleware may wait for the existing approval path inside a running tool. */
    requestHostToolApproval(session: Session, item: RunToolApprovalItem): Promise<void>;
    /**
     * A command-line middleware continuation asks inside the running tool, through
     * the same channels as an SDK interruption. Resolves undefined when the call
     * may run (a non-interactive denial is left for its body to report), or to the
     * result the model reads instead.
     */
    requestInlineToolApproval(session: Session, item: RunToolApprovalItem): Promise<InlineToolRejection | undefined>;
    /** After an inline rejection, what each later call of the same step reads instead of running. */
    skippedAfterInlineRejection(session: Session): InlineToolRejection | undefined;
    approve(item: RunToolApprovalItem, options?: ApprovalOptions): void;
    /** `interrupted`：非用户决策的收尾（会话中止、请求异常等），只结算审批状态，不计入审批决策。 */
    reject(item: RunToolApprovalItem, options?: {
        decision?: 'deny' | 'rejectAndExitPlan';
        cancelTurn?: boolean;
        interrupted?: boolean;
    }): void;
    waitFor(session: Session): Promise<void>;
    /** Resolve the main/leader session for a given session (returns self if already main). */
    findMainSession(session: Session): Session;
    /**
     * 权限审批全局真相源。
     *
     * - next(PendingApprovalView) — 当前有队头项等待审批
     * - next(undefined) — 队列空，无待审批项
     *
     * TUI 的 ToolCallApprovalPanel 应订阅此 subject，不再依赖 session.interruptionSubject。
     * ACP/WebUI 广播仍走 session.interruptionSubject（已由本 service 内部双写保持同步）。
     */
    readonly pending$: BehaviorSubject<PendingApprovalView | undefined>;
    /**
     * 取消指定 session 上所有未决的 interruption Deferred。
     * 每个 Deferred 以 Error(reason) 的方式 reject，让 HandleInterruptions
     * 里的 await deferred.promise 唤醒后走 catch 分支，进而释放 Tool-Agent。
     *
     * 幂等：重复调用，或 session 无 pending 时均为 no-op。
     *
     * 典型调用方：AcpStreamManager 在 prompt idle timeout 收尾时调用。
     *
     * 活着的 coordinator detached worker 的 Ask / ExitPlanMode 不会被父轮
     * `prompt_timeout` / Stop 清掉。关父会话或停那个 worker 本身仍会收口。
     *
     * @param sessionId 目标 session（= mainSession.id，即 ACP session id）
     * @param reason 作为 Error.message，透传给 HandleInterruptions 的 catch 分支
     */
    cancelAllForSession(sessionId: string, reason: string): void;
    /**
     * 将 Sandbox 审批请求纳入中断队列，避免直接 interruptionSubject.next() 覆盖
     * 队列中正在展示的其他审批项。
     *
     * @param session 发起 sandbox 审批的 session（bash-tool 所在的 session）
     * @param syntheticItem 由 bash-tool 构造的 sandbox 审批 RunToolApprovalItem
     * @returns 一个 Deferred<void>，bash-tool 通过 _sandboxResolve 回调来 resolve/reject
     */
    enqueueSandboxApproval(session: Session, syntheticItem: RunToolApprovalItem): void;
    tryAutomaticToolRiskApproval(session: Session, item: RunToolApprovalItem): boolean;
    /**
     * 释放已完成 subagent session 在本 service 内部的所有运行时引用，防止长跑主
     * session 反复 spawn subagent 时内存无界增长。
     *
     * 背景：`waitFor()` 会把 mainSession 存进 `parentIdToMainSession`、把子
     * session 存进 `childToMainSession`（都是强引用整个 Session 对象，含 history）。
     * subagent 跑完后没人清理这些映射，导致 337 个 subagent session 全部
     * 常驻内存 → OOM（session b880b68a，heap 8.5h 从 1.1GB 爬到 1.9GB 撞 2GB 上限）。
     *
     * 幂等：session 未注册时为 no-op。只清内存映射，不动磁盘 jsonl。
     *
     * @param target 传 Session 对象时按对象身份校验，同 id 的后继对象不会被误清；
     * 只拿得到 id 的调用方传字符串，此时不做身份校验。
     */
    releaseSession(target: string | Session): void;
}
export interface MessageQueueManager {
    enqueueMessage(session: Session, message: AgentInputItem): string;
    dequeueMessage(session: Session): AgentInputItem | undefined;
    clearQueue(session: Session): void;
    removeMessage(session: Session, index: number): void;
    getQueue(session: Session): AgentInputItem[];
    /**
     * 是否存在可被「↑ 编辑」拉回输入框的排队消息（用户主动输入的纯文本 prompt）。
     */
    hasEditableMessage(session: Session): boolean;
    /**
     * 将队列中所有可编辑的用户消息弹出并与当前输入框内容合并，返回用于回填输入框的文本。
     *
     * - 只弹出可编辑项（见 InputItemUtils.isEditableQueuedMessage），不可编辑项（通知 /
     *   channel / teammate / isMeta 等）保留在队列里继续被自动 drain。
     * - 合并顺序：队列消息（FIFO）在前，当前输入框内容在后，以换行拼接。
     * - 队列中无可编辑项时返回 undefined，调用方应回退到普通历史导航。
     *
     * 对齐 Claude Code 的 popAllEditable（src/utils/messageQueueManager.ts）。
     */
    popAllEditable(session: Session, currentInput: string): PopAllEditableResult | undefined;
    /**
     * 仅弹出队列中**最后一条**可编辑的 queue-hold（Tab 入队）消息，与当前输入框内容合并回填，
     * 其余 queue 消息、所有 steer 消息均保持不动。用于 Option+↑ 编辑队尾消息（对齐 codex）。
     *
     * - 只在 queueHold 项里找最后一条可编辑的（见 InputItemUtils.isEditableQueuedMessage）。
     * - 找不到时返回 undefined，调用方不做任何处理。
     */
    popLastEditableQueueHold(session: Session, currentInput: string): PopAllEditableResult | undefined;
    /**
     * 弹出队列中**所有**可编辑的 queue-hold（Tab 入队）消息，按 FIFO 顺序换行拼接，
     * 放在当前输入框内容的**上方**（queued 在前、currentInput 在后），返回回填文本。
     * steer 消息与不可编辑项均保持不动。
     *
     * 用于「用户 Esc 中断且无 steer 消息」时把 queue 段回填输入框（对齐 codex）。
     * 找不到任何可编辑 queueHold 项时返回 undefined。
     */
    popAllEditableQueueHold(session: Session, currentInput: string): PopAllEditableResult | undefined;
}
/**
 * popAllEditable 的返回结果。
 */
export interface PopAllEditableResult {
    /** 合并后用于回填输入框的文本 */
    text: string;
    /**
     * 被弹出的排队消息里携带的图片（用于回填时重新注册，避免图片丢失）。
     * `placeholderId` 对应回填文本里保留的 `[Image #N]` 占位符，`dataUrl` 是图片
     * 的 data URL。为空数组时表示没有图片。
     */
    images: Array<{
        placeholderId: number;
        dataUrl: string;
    }>;
}
/**
 * Idle queue drain service for the session.queue (Mode A) path.
 *
 * Background: when the agent is busy (`session.agentState !== 'agent_end'`), user input
 * arriving via the UI is enqueued into `session.queue` by `MessageQueueAgentRunInterceptor`
 * with `skipRun=true`. The interceptor's drain branch
 * (`!inConversation && input.length===0 && queue.length>0`) needs an external trigger —
 * a fresh call to `agentService.run([], {context: session})` — to actually consume the queue.
 * Without this service nothing fires that trigger after the current turn ends, so the queued
 * messages sit indefinitely (UI shows them as "sent" but the agent never replies).
 *
 * Responsibility: subscribe to `session.agentStateSubject`. On every `agent_end`, schedule a
 * deferred drain attempt that — when guards pass (not compacting, not Mode B, queue non-empty,
 * not re-entered) — calls `agentService.run(agent, [], {context: session})` so the existing
 * interceptor logic can `mergeConsecutiveUserMessages` the queued items into a fresh turn.
 *
 * Mode B note: in Mode B (deferred dispatch) the rich queue's own dispatcher
 * (`TeamInboxDispatchService`) handles activation. This service short-circuits when
 * `QueueDispatchUtils.isDeferredDispatchEnabledSync()` is true to avoid double dispatch.
 *
 * Scope: one subscription per session, managed via `register` / `unregister`. Idempotent.
 */
export interface IdleQueueDrainService {
    /**
     * Begin monitoring this session for idle queue drain. Idempotent — calling twice on
     * the same session is a no-op.
     */
    register(session: Session): void;
    /**
     * Stop monitoring the session and release the underlying subscription.
     * Safe to call even if the session was never registered.
     */
    unregister(sessionId: string): void;
    /**
     * Explicitly ask for one drain attempt, reusing the exact same guard chain
     * (and the Esc input-refill behaviour) as the `agent_end` subscription.
     *
     * Used by `InterruptionService` once cancel bookkeeping has landed, so the
     * ordering between bookkeeping and queued-message dispatch is causal rather
     * than timed. Idempotent: the reentrancy guard makes a concurrent call a
     * no-op, and an empty queue returns immediately.
     */
    requestDrain(session: Session): void;
}
/**
 * 「外部用户回合」开始时的度量快照，由 `beginExternalUserRequest` 写入
 * `session.currentTurn`，由 `TurnMetricsReporter` 在回合正常结束时消费。
 */
export interface TurnStartSnapshot {
    /** 回合起点的墙钟时间戳（`Date.now()`） */
    startedAt: number;
    /**
     * 回合起点的 `session.usage.totalTokens` 快照。
     *
     * `session.usage` 是会话级**单调累加**器（每次模型响应都 `usage.add(...)`，
     * 且包含子 agent 回传的消耗），所以「结束时相减」必然得到非负增量。
     */
    tokensAtStart: number;
    /**
     * 本回合是否已经结算过，去重用。
     *
     * 标记打在快照对象自身而不是 `session.currentTurn` 这个槽位上：结算是延迟到
     * 历史落定之后做的，这期间排队消息可能已经 drain 成新一轮、把槽位换掉，
     * 靠槽位判断会把刚结束那一轮的记录整条丢掉。
     */
    reported?: boolean;
    /**
     * 这个起点是不是由内部运行补的（`ensureTurnStart`），而非用户输入触发。
     *
     * 用途只有一个：内部运行可能**不发 `AGENT_ENDED` 就结束**——空 input 遇到
     * 空队列会走 `RUN_SKIPPED`（Mode A 下 IdleQueueDrainService 与
     * BackgroundTaskNotifier 会争同一个 idle 窗口，先到的把队列搬空，后到的那次
     * 就落空），运行抛错则走 `RUN_FAILED`。这两种情况下槽位没人消费，会被下一次
     * 内部运行的 `!currentTurn` 守卫复用，让那条线报出「距上次失败投递的时长」这种
     * 明显偏大的数字。TurnMetricsReporter 据此标记在这两个事件上把它丢掉。
     *
     * 用户回合不打这个标记：它们的槽位在压缩/待重试时是**刻意**保留等续跑的，
     * 不能被同样的规则清掉。
     */
    internal?: boolean;
}
/**
 * 回合度量上报器：在每个外部用户回合正常结束后，往 `session.history` 追加一条
 * `turn-metrics` 记录，由 TUI 渲染为 `✔ Worked for 1m 31s · 12.4k tokens`。
 *
 * 语义对齐 codex 的 `Worked for` 分隔线：**只有正常完成才展示**，用户中断（ESC）
 * 与报错结束都不写记录（但会打 debug 日志说明跳过原因）。
 *
 * 生命周期：`ApplicationLifecycle` 组件，启动时自动实例化并订阅
 * `SessionManager.sessionSubject`，对每个出现过的会话挂一条状态机订阅。
 * `runStateSubject` 在生产代码里从不 `complete()`，订阅必须显式释放，
 * 否则会强引用整个 Session（含 history）造成泄漏。
 */
export interface TurnMetricsReporter {
    /**
     * 停止监听指定会话并释放订阅。会话从未注册过时安全返回。
     * 由 `SessionManager.releaseInMemory` 调用。
     */
    unregister(sessionId: string): void;
}
/** Ids of one model call, as stamped by the model wrapper. */
export interface ModelCallGeneration {
    messageId: string;
    conversationRequestId?: string;
    stepSeq?: number;
}
export interface ModelResponseMetadata {
    /** 响应中的模型 ID */
    model?: string;
    /** 响应中的结束原因 */
    finishReason?: string;
    /** 敏感词过滤时模型返回的内容 */
    contentFilterMessage?: string;
    /**
     * content_filter 命中时，触发安全审查的那次模型响应的 messageId。
     * 该响应产出的所有 history item（assistant message / reasoning / function_call(_result)）
     * 都带 providerData.messageId === 此值，handleContentFilteredResponse 据此剔除并替换为安全提示。
     */
    contentFilterMessageId?: string;
    /** Correlation of the generation that just completed, as stamped by the model wrapper. */
    generation?: ModelCallGeneration;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        completion_tokens_details: {
            accepted_prediction_tokens: number;
            audio_tokens: number;
            reasoning_tokens: number;
            rejected_prediction_tokens: number;
            cached_tokens: number;
        };
        prompt_tokens_details: {
            accepted_prediction_tokens: number;
            audio_tokens: number;
            reasoning_tokens: number;
            rejected_prediction_tokens: number;
            cached_tokens: number;
        };
        prompt_cache_hit_tokens: number;
        prompt_cache_miss_tokens: number;
        cache_read_input_tokens: number;
    };
}
export interface ModelResponseInterceptorContext {
    session: Session;
    result: any;
    modelResponseMetadata?: ModelResponseMetadata;
}
export interface ModelResponseInterceptor {
    /**
     * @returns `true` if the interceptor started a retry (e.g. via agentService.runDefault()),
     *          `false` or `void` otherwise.
     */
    intercept(ctx: ModelResponseInterceptorContext): Promise<boolean | void>;
}
/**
 * Gate for coordinating interceptor completion with view layer.
 * Created synchronously in session-manager's resultSubject callback
 * so that stream-json-view / llm-view can await before sending result.
 */
export interface InterceptorGate {
    /** Final provider reason of this result, available after completed settles. */
    finishReason?: string;
    /** Resolves to `true` if an interceptor started a retry, `false` otherwise. */
    completed: Promise<boolean>;
    resolve: (willRetry: boolean) => void;
}
/**
 * Reads the {@link InterceptorGate} that session-manager stamped onto a specific
 * run result.
 *
 * Use this instead of `session.interceptorGate` whenever the gate is consulted
 * outside the synchronous window in which the result was emitted:
 * `session.interceptorGate` is overwritten by every subsequent result, so a late
 * reader can observe another result's verdict. Returns `undefined` for results
 * that never went through session-manager (unit-test fakes, legacy paths), in
 * which case callers must fall back to their pre-gate behaviour.
 */
export declare function getResultInterceptorGate(result: unknown): InterceptorGate | undefined;
/**
 * 失败 run 的「不再重试」终态标记。
 *
 * session-manager 在 `result.completed` 拒绝后立刻按错误类型预判 gate（网络错误 / 流超时 /
 * 可重试模型错误 / retryInProgress → willRetry=true），而真正是否发起重试由
 * interruption-service 在预算认领、模型错误重试上限、退避取消之后才决定。两边一旦不一致，
 * 只看 gate 的消费方会一直等一条永远不会来的重试 result：stream-json 不写 `type=result`，
 * sandbox-proxy 不回 `session/prompt`，前端停在「生成中」。
 *
 * interruption-service 收尾时若预判会重试、实际没有重试，就在投递终态 result 前打上此标记；
 * 消费方在 gate 判 willRetry=true 时必须再查它，命中即按终态收尾。
 */
export declare function markResultRetryAbandoned(result: unknown): void;
export declare function isResultRetryAbandoned(result: unknown): boolean;
/**
 * 用户取消后的「取消终态」标记：这条 result 是被用户中断的一轮的最后一条，不会再有 continuation。
 *
 * session-manager 只要看到本轮带 interruptions（工具审批）就把 gate 判为 willRetry=true——审批放行后
 * 继续执行确实会产出后续 result。但用户在审批放行后、工具执行期间取消时，interruption-service 只补齐
 * 未完成工具的 synthetic tool_result（skipRun）、执行 Stop hook，然后重投同一条 result，不会再有后续
 * result。只看 gate 的消费方于是一直等待：stream-json 不写 `type=result`，sandbox-proxy 不发 endTurn。
 *
 * 只有 interruption-service 在取消收尾时确切知道「没有 retry / continuation / compaction 接管」，
 * 由它在投递 result 前打上此标记。消费方在 gate 判 willRetry=true 时必须再查它，命中即按**取消**收尾
 * （区别于 {@link markResultRetryAbandoned} 的错误终态）。
 */
export declare function markResultCancelledTerminal(result: unknown): void;
export declare function isResultCancelledTerminal(result: unknown): boolean;
export interface SessionHistoryCleanupOptions {
    /** Override cleanupPeriodDays for this run. */
    days?: number;
    /** Preview deletions without mutating the filesystem. */
    dryRun?: boolean;
}
export interface SessionHistoryCleanupResult {
    retentionDays: number;
    dryRun: boolean;
    skippedByEnvironment: boolean;
    scannedSessions: number;
    expiredSessions: number;
    deletedSessions: number;
    skippedInUseSessions: number;
    deletedArtifacts: number;
    deletedTraces: number;
    deletedAuxiliary: number;
}
export interface SessionHistoryCleanService {
    /** 启动清理服务 */
    start(): Promise<void>;
    /** 停止清理服务 */
    stop(): void;
    /** 手动执行一次原有会话清理 */
    cleanup(): Promise<void>;
    /** 手动执行一次用户可触发的安全本地数据清理 */
    cleanupLocalData(options?: SessionHistoryCleanupOptions): Promise<SessionHistoryCleanupResult>;
}
/**
 * 输入历史记录项
 */
export interface InputHistoryItem {
    /** 显示的输入内容 */
    display: string;
    /** 粘贴的内容 */
    pastedContents: Record<string, any>;
    /** 时间戳 */
    timestamp: number;
    /** 项目路径 */
    project: string;
}
export declare const INPUT_HISTORY_STORAGE_FILE = "history.jsonl";
/**
 * 输入历史服务接口
 */
export interface InputHistoryService {
    /**
     * 添加输入历史记录
     * @param item 历史记录项（不包含 timestamp 和 project，由服务自动填充）
     */
    addHistory(item: Omit<InputHistoryItem, 'timestamp' | 'project'>): Promise<void>;
    /**
     * 获取当前项目的历史记录
     * @param limit 返回的最大记录数，默认100
     */
    getHistoryForProject(limit?: number): Promise<InputHistoryItem[]>;
    /**
     * 清理历史记录
     * @param olderThanDays 清理多少天前的记录，默认30天
     */
    cleanupHistory(olderThanDays?: number): Promise<void>;
}
export {};
//# sourceMappingURL=session-protocol.d.ts.map