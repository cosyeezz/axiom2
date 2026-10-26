import { Application, ApplicationLifecycle, Provider } from '@celljs/core';
import { type AgentInputItem, type PermissionMode, type ReasoningEffortLevel, RunResult, SessionStartSource, type StreamedRunResult } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { BehaviorSubject } from 'rxjs';
import { SessionRequestContextHost, SessionSettingsHost as SettingsManager, SessionUsageHost as UserStateManager } from './session-host-protocol';
import { SessionBackgroundTaskHost as ToolManager, SessionCheckpointHost as CheckpointService, SessionProgressHost as ProgressSyncService, SessionResponseObserver as GalileoSessionBridge, SessionResponseTelemetryHost as TelemetryService, SessionSchedulerHost as CronSchedulerService, SessionSecurityReviewHost, SessionSensitiveProjectionHost, SessionTaskLifecycleHost as AgentTaskManager } from './session-manager-host-protocol';
import { AgentInputItemProcessor, InterruptionService, ModelResponseInterceptor, ModelResponseMetadata, OverrideModelSource, Session, SessionFactory, SessionGetOptions, SessionHookManager, SessionManager, SessionStore } from './session-protocol';
import { SessionRunStateMachine } from './session-run-state-machine-protocol';
/**
 * 将 async iterator 包装成可被 abort signal 强制中断的版本
 *
 * 问题背景：当用户按 ESC 触发 abort 后，底层的 async iterator（如 OpenAI SDK 的流）
 * 可能不会立即退出 —— 它可能在等待下一个 chunk 到来。这会导致 UI 卡在
 * "Printing..." 状态无法响应用户中断。
 *
 * 解决方案：使用 Promise.race 将每次 iterator.next() 与一个 abort 监听器竞争。
 * 如果 abort 被触发且在配置的宽限期内 iterator 没有产生新值，强制退出。
 */
export declare function createAbortableIterator<T>(iterator: AsyncIterator<T>, signal: AbortSignal, logger: Logger): AsyncGenerator<T, void, unknown>;
export declare class SessionManagerImpl implements SessionManager, ApplicationLifecycle<Application> {
    protected readonly sessionFactory: SessionFactory;
    protected readonly settingsManager: SettingsManager;
    protected readonly sessionStore: SessionStore;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly agentInputItemProcessorProvider: Provider<AgentInputItemProcessor>;
    protected readonly logger: Logger;
    protected readonly telemetryService: TelemetryService;
    protected readonly interruptionService: InterruptionService;
    protected readonly interceptors: ModelResponseInterceptor[];
    protected readonly userStateManager?: UserStateManager;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly securityReview?: SessionSecurityReviewHost;
    protected readonly progressSyncService: ProgressSyncService;
    protected readonly checkpointService: CheckpointService;
    protected readonly agentTaskManager: AgentTaskManager;
    protected readonly cronSchedulerService: CronSchedulerService;
    protected readonly galileoSessionBridge: GalileoSessionBridge;
    sessionSubject: BehaviorSubject<Session | undefined>;
    protected readonly toolManager: ToolManager;
    protected readonly requestContext: SessionRequestContextHost;
    protected readonly sensitiveProjection: SessionSensitiveProjectionHost;
    private context;
    /** Per-async-context flag：当前 async 链里的 addHistory 应被静默跳过（用于后台 agent 如 memory extraction） */
    private skipHistoryContext;
    private sessionStartTimes;
    private addHistoryLocks;
    private promptAdmissions;
    private resultSubscriptions;
    private readonly resultSubscriptionOwners;
    /**
     * 每个 sessionId 当前活着的会话对象。身份守卫不能只认 result 订阅的登记：
     * 订阅由调用方事后 `initRunResultHandler` 挂上（teammate / agent-task），而
     * drain / team-inbox / turn-metrics 在 create 时就按 id 注册了，中间那段
     * 「已注册、无订阅」的窗口里 owner 读不到，旧任务的延迟释放会摘掉同 id 后继
     * 会话的注册。WeakRef：登记不得延长会话寿命，deref 为空即无需保护的对象。
     */
    private readonly liveSessionsById;
    private overridePermissionModes;
    private overrideModels;
    /** 与 overrideModels 同生命周期的意图来源（user / declared / materialized）。 */
    private overrideModelSources;
    /**
     * Issue #12554：会话级 thinking override（按 sessionId 隔离）。
     * 由 ACP setSessionConfigOption('thought_level') 或 prompt _meta 写入。
     * 不污染用户全局 settings.json。
     *
     * 持久化策略（by design）：
     *   ❌ 不进 session-store / replay，进程重启后归零，由 ModelConfigInterceptor
     *      回退到 settings.alwaysThinkingEnabled / settings.reasoningEffort / model defaultEffort。
     *   原因：
     *     1) 与同组 overridePermissionModes / overrideModels 保持对称（都是 control-signal 临时态）
     *     2) "会话级配置跟着会话生命周期走"，重启即意味着新一次工作上下文，不应继承上次档位
     *     3) 若产品上需要"新会话默认 high"，应走全局 settings，而非把临时 override 持久化
     *   想为某个会话钉死档位 → 用 ACP setSessionConfigOption 在 session 启动后再设一次。
     */
    private overrideThinking;
    /**
     * 会话级上下文预算档位覆盖（Issue #57413），单位 token，如 200000 / 1000000。
     * 与 overrideThinking / overrideModels 同族：进程内按 sessionId 索引、不落盘，
     * releaseExactSessionState 时随会话一并回收。
     */
    private overrideContextWindow;
    run<R>(session: Session, callback: (...args: any[]) => R): R;
    /**
     * 在 callback 的整个 async 执行链里跳过 addHistory。
     * 用于后台 agent（如 memory extraction）不污染主 session 历史记录。
     * AsyncLocalStorage 保证 per-async-context 隔离，不影响并行运行的主 agent。
     */
    runWithoutHistory<R>(callback: () => R): R;
    private readTimestamp;
    private setTimestamp;
    private ensureHistoryItemTimestamp;
    private stampModelStreamEventTimestamp;
    private stampModelHistoryItemTimestamp;
    private isRecord;
    private formatCreditForLog;
    getCurrent(): Session;
    setCurrent(session: Session): void;
    getMostRecent(): Promise<Session | undefined>;
    /**
     * 是否存在仍在存活（pending/running）的后台任务或后台子 agent。
     *
     * `run_in_background=true` 的 Bash/PowerShell 命令，以及经 Agent 工具以
     * `run_in_background=true` 派生的后台子 agent，都会脱离主 session 的运行状态机
     * 独立执行——主 session 状态机可能已回到 IDLE（模型已把控制权交还用户），
     * 但这些后台任务其实仍在跑。仅凭 `stateMachine.isIdle(session)` 判断会漏掉这种情况，
     * 导致空闲通知误报"等待用户输入"（见 #81620）。
     */
    private hasLiveBackgroundTask;
    private idleTimers;
    private stopped;
    onStop(): void;
    /**
     * 本进程当前已通过 get() 加载过的 sessionId 集合。
     *
     * 用于 SessionHistoryCleanService：仅凭 JSONL 文件 mtime 判断"过期"会误删用户刚用
     * `-r <id>` / loadSession 恢复、但还没发新消息的会话（此时既不会更新 mtime，也不会
     * 有 idleTimer/resultSubscription 等其它"活跃"标记）。get() 成功加载即登记；
     * remove()/releaseInMemory() 时摘除，语义与其它 sessionId 索引的注册表一致。
     */
    private readonly loadedSessionIds;
    private resetIdleTimer;
    private readonly preparedToolResults;
    private readonly historyPreparations;
    private canPrepareToolResults;
    addHistory(session: Session, input: string | AgentInputItem[], continueTurn?: boolean): Promise<void>;
    private writeHistory;
    /**
     * Record a UserPromptSubmit hook block as an in-band assistant message
     * (issue #71907, cc-aligned: cc surfaces a warning system message and ends the
     * turn instead of failing the prompt — claude-code processUserInput.ts:193-209).
     *
     * Called inside addHistory's per-session lock (no re-entrancy), so a single
     * write reaches every surface at once:
     *   - session.history            → transcript / next-turn context
     *   - inputSubject               → TUI live rendering (existing hook-message path)
     *   - combineSubject             → ACP live sessionUpdate (agent_message_chunk)
     *   - sessionStore.appendHistory → JSONL transcript (replayable)
     *
     * The HookBlockedError still propagates afterwards to abort the run; ACP maps
     * it to stopReason 'end_turn' (acp-view), TUI to abort + forceIdle
     * (use-message-sender). chalk=false because ACP does not strip ANSI codes.
     */
    private recordHookBlockedMessage;
    /**
     * 把一条 mod 打出来的 `$.ui.log` 落到当前 session 的可见消息流里。
     *
     * ## 与 `recordHookBlockedMessage` 的关系
     *
     * 二者走**同一条落地路径**（history + inputSubject + combineSubject +
     * sessionStore.appendHistory），因此 TUI / ACP / persisted transcript 都用
     * 既有渲染，不必新增 sessionUpdate 类型（对齐根 CODEBUDDY.md 的 ACP 约束）。
     *
     * ## 与 hook 阻断消息刻意不同的三点
     *
     * 1. **不动 `session.lastMessageId`**：hook-block 是回合终点，需要挂上 replay
     *    分支；mod-log 是**装饰性**通知，如果推进 lastMessageId 会让 `/rewind`
     *    退到"一条 log 中间"，语义混乱。
     * 2. **不挂 `parentId`**：同样出于 replay 分支洁净。
     * 3. **`chalk: false`**：ACP 侧不剥 ANSI，chalk 转义码会露出到 Web UI；此外
     *    宿主已在 `<plugin>: <text>` 里给足了归属信号，terminal 也不再需要额外
     *    颜色包装（TUI 侧后续可按 `hookStatus === 'mod-log'` 做专属渲染）。
     *
     * ## 失败语义
     *
     * 与 hook-block 同款：写盘失败只记日志，不向外抛 —— mod 打日志不该把 CLI 弄挂。
     *
     * @param session 目标 session（宿主取当前 session 后传入）
     * @param text 已由宿主前缀成 `<plugin>: <text>` 的完整行文
     * @param plugin 发起本次调用的 mod 名（`origin.plugin`），用于前端识别
     */
    recordModLogMessage(session: Session, text: string, plugin: string): Promise<void>;
    private readonly inflightSessionStarts;
    emitSessionStart(session: Session, source: SessionStartSource): Promise<void>;
    create(options?: Partial<Session>, needHandleRunResult?: boolean, parentSession?: Session): Promise<Session>;
    initRunResultHandler(session: Session): void;
    protected handleRunResult(session: Session): Promise<void>;
    protected handleStreamRunResult(session: Session, result: StreamedRunResult<any, any>, modelResponseMetadata: ModelResponseMetadata): Promise<void>;
    /**
     * Issue #65246：把 API 实际响应的物理模型 id 存到 session.meta，
     * 供 ACP injectMeta 透传给前端，用于 auto 模式展示「推荐模型（xxx）」。
     */
    private recordResponseModel;
    /**
     * 记录一次模型响应的 finish_reason（Chat Completions 的 choice 与 Responses API 终态事件共用）。
     */
    private recordModelFinishReason;
    /**
     * content_filter 安全审查终止处理。
     *
     * 被过滤这一轮的**全部**模型产出（assistant message / reasoning / function_call(_result)）
     * 需要从有效对话中剔除，并用一条安全提示占位消息替代。
     *
     * 注意「一轮」的边界是**用户消息**，不是单次模型调用：agent loop 里一轮会打 N 次模型，
     * 安全审查往往命中第 N 次，而前 N-1 次已经产出了 assistant + tool。若只回退到被拦那次
     * 之前，前面几次的产出会留在链上，而触发的 user 消息又被 applyContentFilterCleanup
     * 排除出 model input，导致模型看到「上一轮回答 → 本轮 assistant」两条相邻 assistant
     * 且没有对应提问。因此 fork 点取该轮的 user 消息。
     *
     * 实现用 parentId fork（不重写 history 文件）：history 文件是 append-only，
     * 这里仅 **追加** 一条 notice，其 parentId 指向该轮的 user 消息。
     * HistoryUtils.getActiveHistory 从尾部沿 parentId 回溯构建有效历史时，会自然跳过被过滤这一轮的所有 item
     * —— 模型上下文（history-interceptors）、UI 展示/重放（session-replay）等都走这条有效历史，无需各自处理。
     *
     * 配合点：
     * - notice 文案在此存英文（agent-cli 无 locale）；WB 实时展示由 agent-ui 按语言本地化。
     * - notice 与“触发的 user 消息”仍会经 HistoryUtils.applyContentFilterCleanup 从下一轮 model input 中排除
     *   （user 消息保留在有效历史中供展示，但不回传模型）。
     */
    protected handleContentFilteredResponse(session: Session, filteredMessageId: string, requestId?: string): Promise<void>;
    protected handleNonStreamRunResult(session: Session, result: RunResult<any, any>, _modelResponseMetadata: ModelResponseMetadata): Promise<void>;
    protected processInputItem(item: AgentInputItem, session: Session): Promise<void>;
    syncSecurityReviewConclusions(session: Session): Promise<void>;
    appendHistoryFact(session: Session, item: AgentInputItem): Promise<void>;
    flushHistory(session: Session): Promise<void>;
    save(session: Session): Promise<void>;
    initializeForkHistory(session: Session): Promise<void>;
    get(id: string, options?: SessionGetOptions): Promise<Session | undefined>;
    /**
     * 该 sessionId 是否已在本进程通过 get() 加载过（且尚未 remove()/releaseInMemory()）。
     *
     * 仅用于判断"是否仍被本进程使用中"这类保守性检查（例如历史清理前的跳过判断），
     * 不代表该 session 当前正在运行 agent 任务——只要曾被加载且未释放即为 true。
     */
    isLoadedInMemory(id: string): boolean;
    getWiredInMemory(id: string): Session | undefined;
    getAll(): Promise<Session[]>;
    getAllAcrossProjects(): Promise<Session[]>;
    getAllByWorkdir(cwd?: string | null, options?: {
        sinceMs?: number;
    }): Promise<Session[]>;
    remove(id: string): Promise<void>;
    removeAcrossProjects(id: string): Promise<void>;
    private cleanupForRemoval;
    /**
     * 释放已完成 subagent session 的所有常驻内存注册表引用（不删磁盘 jsonl）。
     * 见 SessionManager 接口注释——修复长跑主 session 反复 spawn subagent 的 OOM。
     *
     * 覆盖所有以 sessionId 强引用 Session 对象的注册表：
     *   - resultSubscriptions（handleRunResult 订阅 resultSubject，闭包捕获 session）
     *   - idleTimers / sessionStartTimes / override*（本类内部）
     *   - IdleQueueDrainService / TeamInboxDispatchService（订阅 agentStateSubject）
     *   - TurnMetricsReporter（订阅 runStateSubject）
     *   - InterruptionService（childToMainSession / parentIdToMainSession / interruptionQueues）
     *
     * 幂等：未注册的 id 为 no-op；DI 容错：精简变体缺 service 时降级跳过。
     */
    releaseInMemory(target: string | Session): void;
    rename(session: Session, name: string): Promise<void>;
    setOverridePermissionMode(sessionId: string, mode: PermissionMode): void;
    getOverridePermissionMode(sessionId: string): PermissionMode | undefined;
    clearOverridePermissionMode(sessionId: string): void;
    setOverrideModel(sessionId: string, model: string, source?: OverrideModelSource): void;
    getOverrideModel(sessionId: string): string | undefined;
    getOverrideModelSource(sessionId: string): OverrideModelSource | undefined;
    clearOverrideModel(sessionId: string): void;
    setRuntimeModel(session: Session | undefined, modelId: string, source?: OverrideModelSource): void;
    setRuntimeOutputStyle(session: Session | undefined, style: string): void;
    /**
     * Issue #83229：把 settings.json 中的 model / outputStyle 读一次"钉"进 session.options，
     * 让本 session 后续 run 只读 session、不再读 settings.get()，从而实现"改 settings 不
     * 影响当前会话，只在 /clear 或重启后应用"。
     *
     * resume（-c / -r）分支不走 create、走 sessionStore.get()，SessionStore 目前只反序列
     * 化 history/meta/时间戳，不落盘 session.options。SessionAdmissionService 因此会对
     * 从 Store 恢复出的 Session 再调用本方法，在 admission 时把当前 settings 读一次作为
     * 新进程内的会话快照。复用当前内存 Session 时不重复 seed，避免会话中途修改 settings
     * 后改变现有会话；显式请求参数仍在后续 merge 时覆盖该快照。
     */
    seedStartupSettingsSnapshot(session: Session): Promise<void>;
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
     * 设置会话级上下文预算档位（Issue #57413）。传 `null` 清除。
     *
     * 与 setOverrideThinking / setOverrideModel 同族：进程内按 sessionId 索引的
     * control-signal，不落盘（releaseExactSessionState 时随会话一并回收）。档位合法性
     * （是否属于当前模型 supportedLengths）由调用方 ACP 层校验；
     * `resolveEffectiveContextBudget` 会对非法值二次 fail-closed。
     */
    setOverrideContextWindow(sessionId: string, value: number | null): void;
    getOverrideContextWindow(sessionId: string): number | undefined;
}
//# sourceMappingURL=session-manager.d.ts.map