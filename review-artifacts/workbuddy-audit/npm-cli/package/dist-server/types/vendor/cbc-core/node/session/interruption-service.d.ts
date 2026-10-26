import { type AgentInputItem, type RunResult, RunToolApprovalItem, type StreamedRunResult } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { BehaviorSubject } from 'rxjs';
import { type AgentRunScope as IAgentRunScope } from '../agent/agent-run-scope';
import { SessionConsoleHost, SessionStartupHost } from './session-host-protocol';
import { SessionApprovalMemoryHost, SessionBackgroundApprovalHost, SessionChannelPermissionHost, SessionInterruptionBroadcastHost, SessionInterruptionInteractionHost, SessionInterruptionProfilerHost, SessionInterruptionRecoveryHost, SessionInterruptionSecurityHost, SessionInterruptionToolHost, SessionInterruptionTraceHost, SessionPermissionHookHost, SessionSdkPermissionHost } from './session-interruption-host-protocol';
import { type InlineToolRejection, InterruptionService, type PendingApprovalView, Session, SessionHookManager, SessionManager } from './session-protocol';
import { SessionRunStateMachine } from './session-run-state-machine-protocol';
type IIdleQueueDrainService = import('./session-protocol').IdleQueueDrainService;
/**
 * 宿主注入的开关：让用户显式的「总是允许」优先于 forced ask 决策（truthy 即开启）。
 *
 * 默认不设置 —— `canUseCachedApproval` 保持历史语义（forced ask 压制记忆批准），CLI 产品
 * 行为零变化。宿主（WorkBuddy）用 PreToolUse hook 做高积分等前置确认闸门，而 hook 是无状态的、
 * 每次都会重新返回 `'ask'`，在默认语义下「总是允许」等于永久失效，故由宿主显式打开。
 *
 * 与 `packages/workbuddy-server/src/agent/cli-runtime-env.ts` 及
 * `sidecar-manager.ts` 的 `buildCliEnvFromResolved` 两处注入点同步（那边是两条独立的
 * spawn 链路，且无法 import 本常量 —— workbuddy-server 不依赖 cbc-core）。
 */
export declare const ENV_ALWAYS_APPROVAL_OVERRIDES_HOOK_ASK = "CODEBUDDY_ALWAYS_APPROVAL_OVERRIDES_HOOK_ASK";
export declare class InterruptionServiceImpl implements InterruptionService {
    private readonly resolvedSandboxItems;
    private pendingInterruptions;
    private itemToSessionMap;
    private readonly sandboxReviews;
    private interruptionQueues;
    private parentIdToMainSession;
    private childToMainSession;
    private waitForSubscriptions;
    private readonly approvalSources;
    private readonly handlingStates;
    private readonly reportedStaleStates;
    private readonly reportedDiscardedApprovals;
    private readonly handledResults;
    private readonly resumeProgress;
    /**
     * Terminal by design: a blocked continuation already proved it cannot make
     * progress, and a later user request arrives on a *new* RunState, so the
     * session is never stranded.
     */
    private readonly blockedResumeStates;
    /**
     * Deliberately not `session.meta.consecutiveEmptyDrainCount`: the idle
     * empty-drain guard both increments that counter (tripping this
     * continuation early, aborting a legitimate resume) and resets it
     * (stretching the budget without bound).
     */
    private readonly resumeNoProgressCount;
    /** The step (`_currentTurn`) of a run whose calls an inline rejection stopped. */
    private readonly inlineRejectedSteps;
    /** Inline approvals of a run still waiting, so a rejection settles its siblings. */
    private readonly inlinePendingApprovals;
    /**
     * Runs an inline rejection ends. `terminal`: the user stopped the turn, so Stop
     * hooks do not run. `interrupt`: the turn ends as an SDK interruption did.
     */
    private readonly inlineRejectionEnds;
    private assertApprovalSource;
    private approveSource;
    private awaitPermissionReply;
    /**
     * A decision the user actually clicked must never disappear without a word.
     *
     * The card is dequeued and the deferred rejected, but the run that owned it
     * is already gone — so nothing downstream surfaces the rejection and the
     * user is left believing the tool was approved.
     */
    private reportDiscardedDecision;
    private reportStaleSource;
    /**
     * 权限审批全局真相源（方案一：统一数据源）。
     *
     * 所有入队/出队/刷新队头的写点都必须经 {@link publishPending} 同步到此 subject，
     * 由 TUI 的 ToolCallApprovalPanel 直接订阅，不再依赖 session.interruptionSubject。
     *
     * 背景：多 teammate 并发审批时，findMainSession 在 parentIdToMainSession
     * 未及时注册的竞态窗口会 fallback 到 sourceSession 自身，导致 interruptionSubject
     * 被 next() 到非 TUI 绑定的 session 上——状态行显示 "waiting for permission"
     * 但弹窗永远不出现。pending$ 作为全局唯一真相源根治此错位。
     */
    readonly pending$: BehaviorSubject<PendingApprovalView | undefined>;
    protected readonly toolHost: SessionInterruptionToolHost;
    protected readonly startupHost: SessionStartupHost;
    protected readonly interactionHost: SessionInterruptionInteractionHost;
    protected readonly recoveryHost: SessionInterruptionRecoveryHost;
    protected readonly toolAlwaysApprovalService: SessionApprovalMemoryHost;
    protected readonly securityReview?: SessionInterruptionSecurityHost;
    protected readonly sessionHookManager: SessionHookManager;
    /**
     * `@Optional()`：与 SessionManager 存在循环依赖（SessionManager 已注入本 service），
     * 精简容器 / 单测未装配 SessionManager 时跳过 SessionStart(compact) 补发。
     */
    protected readonly sessionManager?: SessionManager;
    protected readonly consoleManager: SessionConsoleHost;
    protected readonly logger: Logger;
    protected readonly sdkPermissionClient: SessionSdkPermissionHost;
    /**
     * requestHostPermission 的 control_request 信封 id 计数——同毫秒唯一性。
     * 实例字段循 Sdk*Client 判例（private requestIdCounter）；片 3 传输
     * seam 化时随 id 生成一并迁入 client 类。
     */
    private hostPermissionRequestCounter;
    protected readonly sdkHooksManager: SessionPermissionHookHost;
    protected readonly backgroundTaskToolApprovalService: SessionBackgroundApprovalHost;
    protected readonly channelPermissionAdapter?: SessionChannelPermissionHost;
    protected readonly acpBroadcastService?: SessionInterruptionBroadcastHost;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly agentRunScope?: IAgentRunScope;
    /**
     * 取消记账落盘后由 finally 显式触发队列 drain。
     *
     * `@Optional()`：这是本 service → IdleQueueDrainService → AgentService 的下行
     * 依赖，而 AgentService 侧并不反向依赖本 service，图上无环；`@Optional()` 只是
     * 沿用仓库既有做法，兼容 headless / 精简容器与未装配该组件的单测。
     */
    protected readonly idleQueueDrainService?: IIdleQueueDrainService;
    protected readonly traceCollector?: SessionInterruptionTraceHost;
    protected get startupProfiler(): SessionInterruptionProfilerHost;
    /**
     * 标记「用户取消本轮」的拒绝项（`reject(item, { cancelTurn: true })`）。
     * 语义是取消当前 turn，而不是「拒绝并让模型带反馈续跑」。
     * 记在 WeakSet 而不是 `rawItem.providerData`（那会落进历史），也不改
     * deferred 的 reject 形状（下游按 error 类型分支的逻辑保持不变）。
     */
    private readonly cancelTurnItems;
    /** Claim before calling out: sandbox callbacks can throw or synchronously re-enter. */
    private takeSandboxResolve;
    private getToolRiskApproval;
    private attachToolRiskApproval;
    private getTrustedToolRiskApproval;
    private recordToolRiskApprovalDecision;
    private applyAutomaticRiskDecision;
    private finishSandboxReview;
    private applySandboxReview;
    private recordSandboxApprovalDecision;
    private scheduleSandboxReview;
    approve(item: RunToolApprovalItem, options?: {
        alwaysApprove?: boolean;
        scope?: 'session' | 'localSettings';
    }, approvalSession?: Session): void;
    reject(item: RunToolApprovalItem, options?: {
        decision?: 'deny' | 'rejectAndExitPlan';
        cancelTurn?: boolean;
        interrupted?: boolean;
    }): void;
    /**
     * 取消指定 session 上所有未决的 interruption Deferred。
     *
     * 语义：`sessionId` 与 InterruptionService 内部 `interruptionQueues` 的 key 一致
     * （即 mainSession.id / ACP session.id）。对该主 session 下所有入队但尚未 approve/reject
     * 完毕的中断项，逐个以 `new Error(reason)` reject 其 Deferred；随后清理主队列、索引、UI 状态。
     *
     * 幂等：
     *   - sessionId 无对应队列或队列已为空时，仅打 debug 日志并直接返回
     *   - 第二次调用因队列已被清空，天然 no-op
     *
     * 安全性：
     *   - 已 approve/reject 完成的 item 早已被 dequeue 从 `interruptionQueues` 移除，
     *     本方法只作用于"仍然挂在队列里的 pending item"，不会重复 reject 已 settle 的 Deferred
     *   - 使用快照遍历，避免边遍历边删导致迭代器异常
     *   - 本方法同步执行：reject Deferred 本身是同步操作，等待 `deferred.promise` 的 `await`
     *     会在下一个 microtask 被唤醒进入 catch 分支（这是预期行为）
     *   - 活着的 coordinator detached worker 的 Ask / ExitPlanMode 不随父轮收口；
     *     `session_teardown` 或停那个 worker 本身仍会清掉
     */
    cancelAllForSession(sessionId: string, reason: string): void;
    /**
     * 父轮 idle / Stop / 沙箱超时不能收口活着的 detached worker Ask/plan。
     * 关父会话仍收口。识别失败时 fail-closed，保持原来的全量清队。
     */
    private shouldPreserveLiveDetachedWorkerHitl;
    /**
     * 释放已完成 subagent session 的所有运行时映射，避免长跑主 session 反复
     * spawn subagent 时 `parentIdToMainSession` / `childToMainSession` /
     * `interruptionQueues` 无界增长导致 OOM。见 protocol 注释。
     *
     * 幂等：未注册的 sessionId 为 no-op。
     */
    releaseSession(target: string | Session): void;
    protected handleInterruptions(session: Session, interruptions: RunToolApprovalItem[], result?: RunResult<any, any> | StreamedRunResult<any, any> | undefined): Promise<void>;
    /** An in-process middleware continuation waits here without finishing the SDK run. */
    requestHostToolApproval(session: Session, item: RunToolApprovalItem): Promise<void>;
    requestInlineToolApproval(session: Session, item: RunToolApprovalItem): Promise<InlineToolRejection | undefined>;
    skippedAfterInlineRejection(session: Session): InlineToolRejection | undefined;
    /**
     * Settles an inline rejection the way processInterruptions does for the same
     * host, without starting a run: the call's result carries the rejection, and
     * a turn that the rejection ends finishes with that step.
     */
    private rejectInline;
    /** Calls of the same step still waiting for approval are rejected with `item`. */
    private rejectWaitingInlineSiblings;
    private autoApproveTool;
    /** Who can decide an approval for this call, resolved once per call. */
    private resolveApprovalChannels;
    /**
     * Asks the channel that owns this call's decision and waits for it: resolves
     * once the call is approved and throws when it is denied or cancelled.
     * `non-interactive`: nobody can be asked, so the call is approved with a
     * cached deny that its body reports.
     */
    private awaitApprovalDecision;
    /** Whether a rejection ends the turn instead of feeding the rejection back to the model. */
    private rejectionInterrupts;
    private isCliUiMode;
    /** What the model reads for a rejected call: the tool's own rejection renderer, else the default rejection. */
    private buildRejectionFeedback;
    private flushRejectedToolTrace;
    private processInterruptions;
    protected executePendingManualPostCompactHook(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any>): Promise<void>;
    waitFor(session: Session): Promise<void>;
    /**
     * ACP owns its queue inside AcpView so every continuation remains covered by
     * the current prompt's forwarding and terminal barriers. A fire-and-forget
     * drain here can steal an ACP steer, let AcpView publish idle, then keep
     * running model work behind that terminal state (#84871).
     */
    private shouldUseLegacyQueueDrain;
    private findSessionByItem;
    /**
     * 在 Workflow 审批入队前预读 saved workflow / scriptPath 的脚本文本,
     * 把结果写到 rawItem.providerData.workflowSourceText,UI 端无需 IO 即可渲染 phases。
     *
     * 触发条件:tool 是 DeferExecuteTool(Workflow) 且 inline script 缺失。
     * 失败/缺 resolver 不抛异常,UI 退化到只展示 source 名。
     */
    private maybePreloadWorkflowSource;
    /**
     * 是否应抑制中断层的"直接批准"短路。
     * auto / dontAsk（以及父会话权限上限为这两者的子会话）下，不能用后台直批
     * 等短路绕过统一权限检查；必须落入正常检查，由统一出口转 classifier / deny。
     */
    private shouldSuppressDirectApproveForMode;
    private canAutoApproveInBypassMode;
    /**
     * 用户显式「总是允许」过的工具，能否复用那次批准（跳过再次弹窗）。
     *
     * 默认（`ENV_ALWAYS_APPROVAL_OVERRIDES_HOOK_ASK` 未设置）：只要存在 forced ask 决策
     * （PreToolUse hook 返回 `'ask'`，或 settings 里的显式 `permissions.ask` 规则命中），
     * 就不复用 —— 与历史行为逐字节一致，CLI 产品不受影响。
     *
     * 开关打开（宿主注入，当前是 WorkBuddy）：用户当场点过的「总是允许」优先于 forced ask。
     * 背景：宿主用 PreToolUse hook 做高积分等前置确认闸门，而 hook 每次调用都会重新返回
     * `'ask'`，在默认语义下「总是允许」等于永久失效 —— 按钮点了不生效，每次照弹。
     * 取向是「用户当场的显式意图 > 静态配置/无状态 hook」。
     *
     * 但 runtime-security 的 `requireApproval` **不让位**：它不是「用户可记住」的语义，
     * 让位等于让一次「总是允许 Bash」把安全闸门一并绕过（fail-open）。
     */
    private canUseCachedApproval;
    /**
     * 该工具调用是否挂着尚未由用户裁决的 runtime-security 强制审批。
     *
     * `PreToolUseHookResult.runtimeSecurity` 是 `Record<string, unknown>`（跨层透传的裸对象），
     * 逐字段收窄而不是整体 cast —— 上游字段形态变化时这里应该安全地判为「无待决审批」，
     * 而不是在热路径上抛异常。
     */
    private hasPendingRuntimeSecurityApproval;
    private isMandatorySkillApproval;
    private isProductManagedSkillApproval;
    private clearSkillApprovalDecision;
    private hasForcedAskDecision;
    private getCachedPreToolUseResult;
    private getPreToolUseCallId;
    /**
     * Check if a RunToolApprovalItem is a Bash tool call with a HIGH or CRITICAL risk command.
     * Used to prevent auto-approval of dangerous commands (e.g. sudo, rm -rf, git reset --hard)
     * even when BypassPermissions mode is active.
     *
     * Note: Users can still bypass this by explicitly configuring allow rules in their
     * settings file (trusted ALLOW rules in Phase 2 take priority over this check).
     */
    private isDangerousBashCommand;
    private isMandatoryHighCreditApproval;
    /**
     * 查找 session 对应的 mainSession
     * 如果是子 session，通过 parentSessionId 从映射中获取 mainSession
     */
    findMainSession(session: Session): Session;
    tryAutomaticToolRiskApproval(session: Session, item: RunToolApprovalItem): boolean;
    /**
     * 将 Sandbox 审批请求纳入中断队列。
     *
     * 之前 bash-tool 直接调用 `session.interruptionSubject.next(syntheticItem)`，
     * 绕过了队列机制，当队列中已有其他审批项时会互相覆盖。
     *
     * 现在改为通过本方法入队：
     * - syntheticItem 排入 mainSession 的 FIFO 队列
     * - 显示/推进由 showHead / dequeue 统一管理
     * - bash-tool 的 `_sandboxResolve` 回调仍由 approve/reject 中的 sandbox 分支触发
     * - approve/reject 的 sandbox 分支在调用回调后会 dequeue，推进队列
     *
     * 注意：sandbox approval 没有正常的 session.state / pendingMap Deferred，
     * enqueue 产生的 Deferred 不会被 await（bash-tool 使用自己的 Promise + _sandboxResolve）。
     */
    enqueueSandboxApproval(session: Session, syntheticItem: RunToolApprovalItem): void;
    /**
     * 将中断项加入主 session 的中断队列
     * 队头项通过 mainSession.interruptionSubject 显示给用户
     */
    private enqueue;
    /**
     * 从队列移除指定项并推进：显示下一个或清空 UI
     */
    private dequeue;
    /**
     * 扫描所有活跃的 interruptionQueues，返回第一个非空队列的信息。
     *
     * 当 findMainSession 因竞态 fallback 导致队列分裂时，dequeue 清空当前
     * 队列后需要此方法发现"孤儿"队列并接管展示，防止审批项被遗忘。
     */
    private findNextActiveQueue;
    /**
     * 判断一个中断项是否为沙箱审批队列项（通过 enqueueSandboxApproval 入队的新权限路径）。
     * 用于将队列分裂兜底逻辑限定在沙箱场景，避免影响普通 tool approval 路径。
     */
    private isSandboxQueueItem;
    /** 仅复用本次会话授权，先移除重复项，再由当前项出队推进 UI。 */
    private approveMatchingQueuedSandboxItems;
    /**
     * Sandbox 审批专用出队：处理 findMainSession 竞态导致入队时和出队时
     * 解析到不同 mainSession（不同队列 key）的问题。
     *
     * 入队时 findMainSession 可能因 parentIdToMainSession 未注册而 fallback
     * 到 sourceSession 自身（队列 key = sourceSession.id）。出队时 findMainSession
     * 可能已正确解析（队列 key = mainSession.id），导致 dequeue 找不到队列。
     *
     * 此方法先尝试 findMainSession 解析后的 key，失败则回退到 sourceSession.id。
     */
    private dequeueSandboxItem;
    /**
     * 按 sessionId 查找对应 session 并展示队头。
     *
     * 与 showHead 不同，此方法接受 sessionId 而非 session 引用，用于处理
     * 孤儿队列——队列 key 可能是 sourceSession.id（findMainSession fallback），
     * 此时需要从队列项的 session 引用中获取展示所需的上下文。
     *
     * 如果此时 parentIdToMainSession 竞态已解决（mainSession 已注册），
     * 将孤儿队列迁移到正确的 mainSession key 下再展示。
     */
    private showHeadById;
    /**
     * 显示队头中断到 UI（通过 mainSession.interruptionSubject）
     */
    private showHead;
    /**
     * 更新队头的队列计数信息并触发 UI 刷新
     * 当新项入队但队头未变时调用
     */
    private updateHeadQueueInfo;
    /**
     * 发布队头视图到全局 pending$（方案一：统一数据源）。
     *
     * 接受可空 head：head 为 undefined 或 null 时 next(undefined)，统一处理"队列空"语义。
     */
    private publishPending;
    /**
     * 普通 print（-p）非交互模式判定：与 ToolPermissionService 计算
     * `shouldAvoidPermissionPrompts`（tool-permission-service.ts）完全同源——
     * print 且非 ACP 且非 SDK（stream-json）时，进程没有任何可以弹出审批的入口。
     * 在这种模式下，硬编码 needsApproval=true 的工具不能进 UI 审批分支去 await
     * 一个永不 resolve 的 deferred。
     */
    private shouldAvoidInteractiveApproval;
    /**
     * 非交互模式下把一次工具审批收敛为 deny：缓存一条 PreToolUse deny 结果，
     * 后续 executeToolWithHooks（tool-manager.ts）消费到 allowed=false 会抛
     * PermissionDeniedError，模型据此收到带引导的拒绝说明并继续（run 不 abort、
     * 不复用 ExitPlanMode 的"继续规划"模板，避免模型反复重发）。
     *
     * deny 文案逐字对齐 Claude Code 的 YVu(e)：
     *   `Permission to use ${tool} has been denied. ${PERMISSION_DENIED_GUIDANCE}`
     * 即空 reason 形态（不拼 "because ..."），与 Claude 在非交互下对
     * ExitPlanMode 等工具的 deny 输出一致。
     */
    private denyForNonInteractive;
    private getPendingMapForSession;
    /**
     * Resolve an AskUserQuestion through a transport-owned per-session
     * handler (currently A2A inbound), then feed the answers through the same
     * mutable approval item used by the SDK/host permission paths.
     *
     * This deliberately bypasses AskService: that service owns UI/ACP panel
     * routing and has process-global legacy state. The approval item already
     * gives us the safer continuation seam — merge `answers`, approve, and
     * let the existing RunState continuation execute the tool.
     */
    private requestSessionAskUserQuestion;
    /**
     * 双通道审批：同一个 AskUserQuestion 同时推给 A2A 和 stream-json，
     * 先答的一方生效，输的一方被撤销。
     *
     * 刻意与 `requestSessionAskUserQuestion` / `requestSdkPermission` 并存而
     * 不是重构它们：那三条是**所有**拓扑的必经之路，改它们等于把风险摊给
     * 一堆不相关的场景。门禁不通过时一行都不会走到这里。
     *
     * 代价是下面这段结果应用与那两条相似。相似处都是它们有意为之的细节，
     * 逐条对齐过：resolve 前必须 dequeue（成功路径不经 approve()，不出队会
     * 留下 stale 的全局 pending$）、deny 必须 addPermissionDenial、
     * SdkPermissionDeniedError 的 interrupt 取值决定外层要不要 shouldInterrupt。
     */
    private requestDualChannelApproval;
    /**
     * 先答的一方获胜，随后**无论成败**都把其余 bid 收掉。
     *
     * 两件事必须放在一个函数里：收尾写在调用点的直线代码里时，异常路径
     * （session 被取消、两条通道都故障）会整个跳过它——A2A 的中断停在
     * INPUT_REQUIRED（`parkInteraction` 的 finally 跟着不执行，questionTail
     * 卡死），stream-json 的卡片同样挂着。这是本实现踩过的坑。
     *
     * 竞速本身**不能用裸 `Promise.race`**：race 遇到 reject 会立刻 settle，
     * 于是一条通道的基础设施故障（A2A 的 "task is no longer active"、stdout
     * 管道断开）会被当成「用户拒绝」，把另一条还能正常应答的交互直接拒掉。
     * 正确的划分是：
     *
     * - 返回 allow / deny = 用户决定，获胜
     * - 抛异常 = 故障，这条 bid 退出，继续等另一条
     * - 全部故障才向外报错，退化成今天单通道失败的行为
     * - session abort 照旧立即 reject，不等任何一方
     */
    private raceApprovalChannels;
    private pickApprovalWinner;
    /**
     * 服务面回调审批（QueryOptions.canUseTool，Claude Agent SDK 同形）——
     * requestSdkPermission 的 in-process 版本：同一套 hook 触发、abort 接线、
     * updatedInput 回填（AskUserQuestion 答案同道）与 deny 通道。
     * 回调返回 null = SDK 带外响应契约；回调面首版无带外通道，告警后悬挂
     * （仅 interrupt/abort 可解），行为与 SDK 一致。
     */
    private requestHostPermission;
    /** Apply the host's session mode before the approved tool or its siblings resume. */
    private applyHostPermissionMode;
    private requestSdkPermission;
    private triggerPermissionRequestHook;
    private addPermissionDenial;
    /**
     * Continue agent execution with a message from Stop hook
     *
     * Note: Must wait for the run state to become idle before continuing
     * to avoid MessageQueueAgentRunInterceptor queueing the message
     */
    private continueAgentWithMessage;
    /**
     * 检测最近的历史消息中是否已有 model error（SyntaxError / ModelBehaviorError）重试记录
     * 避免模型持续产生相同错误时反复重试导致无限循环和大量 token 消耗
     *
     * 使用统一标记 "Model error retry" 覆盖 SyntaxError、ModelBehaviorError（含 Tool Not Found）
     * 和 ToolCallError wrapping ModelBehaviorError 三类错误
     * 检查窗口为最近 4 条消息，允许最多 2 次重试
     */
    private static readonly MODEL_ERROR_RETRY_MARKER;
    private static readonly MODEL_ERROR_RETRY_CHECK_WINDOW;
    private static readonly MODEL_ERROR_MAX_RETRIES;
    /**
     * 脱敏 SDK `@openai/agents-core` 抛出的 "Tool X not found in agent Y." 文案：
     * 去掉 " in agent Y" 尾缀（agent.name 是产品实现细节，如 "cli"），
     * 避免其他集成方（如 WorkBuddy / IDE / iOA 等）看到产品特定措辞，
     * 也避免把 agent 名回写给模型干扰其自纠正。
     *
     * 工具名本身可能含空格（如 "todo write"），所以用非贪婪 .+? 匹配到 " not found"。
     * agent 名使用 [^\s.]+ 吸收到第一个空白或句号前（而非 \S+?\.?，
     * 后者会在 "cli." 上只吃掉 "c" 留下 "li."）。
     */
    /**
     * Calls of the same response that were deferred behind a pending approval (agents-core
     * patch: a call waiting for approval blocks the calls after it) never ran. When the user
     * rejects, give them an explicit "not executed" result; otherwise history filling would
     * hand the model an empty output it could mistake for a real (empty) result.
     */
    static buildSkippedSiblingResults(newItems: ReadonlyArray<{
        rawItem?: unknown;
    }> | undefined, interruptions: readonly RunToolApprovalItem[], skipRun: boolean): AgentInputItem[];
    private static sanitizeToolNotFoundMessage;
    private hasRecentModelErrorRetry;
    /**
     * 网络 / 流错误自动恢复的统一前置步骤：认领额度 → 可取消的指数退避 → 标记恢复轮。
     *
     * 认领放在退避之前、且晚于本 catch 里的第一个 await：session-manager 的 gate 在
     * `result.completed` reject 后同步读取同一份预算判据，认领若早于 gate 读取，最后
     * 一次重试会被 gate 误判为「预算已耗尽」而提前下发终态。
     *
     * 退避期间会话处于 RETRYING：失败的 run 与写入中断结果的 skipRun run 都已收尾回 idle，
     * 这里重新置为 busy，TUI 继续显示进行中并响应 Esc，用户新消息进队列而不是直接起 run。
     * 恢复 run 带 bypassMessageQueue 从 RETRYING 直接发起，中间不回 idle，不留让新 run
     * 插入的空窗；恢复 run 收尾（AGENT_ENDED）时回 idle 并带出排队消息。
     *
     * 退避期间用户取消时退回额度、以 RUN_FAILED 收回 idle 并返回 `cancelled`，调用方不得
     * 再发起。取消信号在等待前现取：写入中断结果的 skipRun run 会替换 `session.abortController`，
     * 用户此后按下的 Stop 作用在新 controller 上；排队消息接管 owner 时，其 abort 会级联到这里。
     *
     * 等待结束时若状态既不是 RETRYING 也不是 idle，说明 RETRYING 被迟到的收尾事件冲掉后
     * 已有新 run 被接纳并在执行，返回 `superseded`，否则恢复 run 会与它同时写同一个会话。
     * 此时不退回额度——新请求边界已经清零，再减一次会扣掉新链的额度。
     */
    private prepareRecoveryAttempt;
    /**
     * reasoning-only 空流的续写前置：把模型层随错误交出的思考落史，续写请求才带得上它，
     * 模型可以接着已有思考往下写，而不是从头审题。
     *
     * 只在重试已经确定发起时调用：不重试（预算耗尽、跑满上游时限、退避期间取消）时历史保持原样。
     * 返回 `false` 时调用方退回原样重发——没有思考可接，就不能让提示说「从中断处继续」。
     *
     * 落史形状与 AbortedStreamDraftStore 的中途取消半成品一致（status=incomplete +
     * isPartialAborted）；发请求时由 attachOrphanedReasoningCarriers 补承载项回传给模型。
     */
    private persistEmptyStreamReasoning;
    /**
     * CLI TUI 手打 `/compact` 裸跑成功后补发 SessionStart('compact')。
     *
     * 策略编排路径（Blocking / MaxToken）已在 sendContinueMessage 里发过，
     * 这里用 isCompactInternal + isCompressing 双闸门去重。hook 失败不阻断 Stop 收尾。
     */
    private maybeEmitCompactSessionStart;
    /**
     * #102382 复现脚本专用 debug hook。生产环境 env 未设置时零副作用。
     */
    private maybeInjectDebugEmptyDrainLoop;
}
export {};
//# sourceMappingURL=interruption-service.d.ts.map