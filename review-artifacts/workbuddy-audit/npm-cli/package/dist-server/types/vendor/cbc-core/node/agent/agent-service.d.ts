import { Provider } from '@celljs/core';
import { AuthenticationManager } from '@genie/authentication';
import { type AbortLinkDisposer, Agent, type AgentInputItem, type NonStreamRunOptions, RunState, type StreamRunOptions } from '../../../cbc-shared/node/index.js';
import { type LanguageModel } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { type ManualCompactRequestHandler as ManualCompactRequestHandlerContract } from '../context/context-protocol';
import { type FileRollbackOperationLock as FileRollbackOperationLockContract } from '../file-rollback/file-rollback-service-protocol';
import { Session, SessionManager } from '../session/session-protocol';
import { SessionRunStateMachine } from '../session/session-run-state-machine-protocol';
import { type AgentCurrentContinuationOptions, AgentManager, AgentRunInterceptor, AgentRunRequest, AgentService, type AgentStandardRunOptions, type OneTimeRunOptions, type ReviewerOneTimeRequest, type ReviewerOneTimeResult, RunnerProvider } from './agent-protocol';
import { type AgentRunScope as IAgentRunScope } from './agent-run-scope';
import { AgentPluginRefresh, AgentRunObserver, AgentRuntimeResolver } from './agent-runtime-protocol';
export { abortRemoteResultRun } from './remote-result-control';
export declare class AgentServiceImpl implements AgentService {
    protected readonly runnerProvider: RunnerProvider;
    protected readonly agentManager: AgentManager;
    protected readonly runtimeResolver: AgentRuntimeResolver;
    protected readonly runObserver?: AgentRunObserver;
    protected readonly pluginRuntimeRefreshService?: AgentPluginRefresh;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly sessionManager: SessionManager;
    protected readonly agentRunScope?: IAgentRunScope;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly agentRunInterceptorProvider: Provider<AgentRunInterceptor>;
    protected readonly fileRollbackOperationLock?: FileRollbackOperationLockContract;
    protected readonly logger: Logger;
    protected readonly manualCompactRequestHandler?: ManualCompactRequestHandlerContract;
    /**
     * Preserve the pre-start cancellation snapshot across runDefault's agent
     * lookup controller and run()'s own controller. This is process-local
     * startup ownership, never Session/domain state.
     */
    private previousAbortStateByStartupSignal;
    /**
     * #59319-B: lifecycle owner token — 只有成功 IDLE→PREPARING 的 controller
     * 才被记录为 session 的 lifecycle owner。用于 RUN_FAILED 判据，不依赖
     * session.abortController（会被排队/并发 run 替换以维持 ESC cascade）。
     *
     * 写入时机：admission 锁内 IDLE→PREPARING 成功后 set(session, controller)。
     * 清除时机：owner-aware RUN_FAILED / 正常终结时 compare-and-delete。
     */
    private lifecycleOwners;
    protected getLifecycleOwners(): WeakMap<Session, AbortController>;
    tryCloseTaskSession(session: Session, result: NonNullable<Session['resultSubject']['value']>): Promise<boolean>;
    retireTaskSession(session: Session): Promise<void>;
    waitForRunsSettled(session: Session): Promise<void>;
    /**
     * 有界 join：等到该 session 上的物理 run 全部交还 lifecycle owner 与 in-flight 信号。
     *
     * 为什么需要它而不是直接看 `agent_end`：`finalizeRun` 晚于本轮把最终产出写进
     * history，`agent_end` 却早于 `finalizeRun`。任何依赖「上一轮 history 已写完」这个
     * 因果的调用方（如队列 drain）必须 join 到这里。
     *
     * Bounded: `runSettledSubject` is optional, so a session built without
     * one has nothing to observe and would hang the caller's cleanup — which
     * owns hook, MCP and background-shell teardown. `agent_end` 也可能来自没有物理
     * run 的路径（skipRun / 迟到事件），无界等待会把调用方永久挂住。
     */
    private joinRunsSettled;
    /** compare-and-delete：仅当 token 仍指向本轮 controller 时清除。 */
    private clearLifecycleOwner;
    /** 本轮是否是当前 lifecycle owner。 */
    private isLifecycleOwner;
    /**
     * #59319-2: owner-aware 的统一错误收尾。
     *
     * compare token 后 transition RUN_FAILED + clear lifecycle owner。
     * 若本轮不是 lifecycle owner（token 已被新 run 覆盖），什么都不做——
     * 不得清掉新 owner 的状态。
     *
     * 用于所有 catch 块，避免重复判据代码。
     */
    private failOwnedLifecycle;
    /**
     * 把「无主」的残留运行态收敛回 idle，让准入继续（#153047）。
     *
     * 判据：状态属于 {@link ORPHANED_RUN_STATE_STATUSES}，且既没有 lifecycle owner、
     * 也没有其他在途物理 run——没有任何执行中的 run 能推进它，只能是残留。
     * `currentSignal` 是本轮自己的 controller（调用点若已把本轮登记进在途集合，先排除自己）。
     */
    private convergeOrphanedRunState;
    /**
     * 物理轮正常收尾却仍停在残留态：本轮终态事件没被状态机收下（典型是本轮 `agent_end`
     * 被 agent-factory 的 stale-end 守卫按 RunContext 身份丢弃），会话会永久 busy、
     * 后续 prompt 全部入队 + skipRun（#153047）。
     *
     * 只处理「回合真的结束」的轮次：本轮结果必须是最终输出。工具被安全策略自动拒绝后的
     * continuation、审批恢复等场景，物理轮同样已收尾，但结果是带 interruption 的非最终
     * 输出，回合随后由同一轮继续推进——在那里发终态会把续跑 run 卡在 PREPARING。
     * 「取消」由 {@link convergeCancelledOwnedLifecycle} 处理。
     */
    private convergeSettledOwnedLifecycle;
    /**
     * 物理轮被取消后收敛：把仍归本轮所有的 busy 状态推回 IDLE。
     *
     * 为什么需要它：SDK 的 clean abort 会在 `#handleAbort()` 里直接关流
     * （agents-core@0.5.2），`#runStreamLoop` 对 abort 走 `return` 而非 throw，
     * 于是**可能一个 `agent_end` 都不发**。此时 session 的 busy 状态归本轮所有，
     * 却没有任何合法终态迁移能把它带回 IDLE，spinner 就永远转着。
     *
     * 判据（缺一不可）：
     *   1. `ownsLifecycle` + compare token —— 只有当前 lifecycle owner 能终结
     *      session。token 已被新一轮覆盖（provider retry / 队列续跑）时必须闭嘴，
     *      否则会把别人的运行打回 idle。
     *   2. 本轮 controller **已 abort** —— 只处理「取消」。未取消的残留由
     *      {@link convergeSettledOwnedLifecycle} 收口，且只认「最终输出 + 残留态」；
     *      这里不能扩大到未取消的 busy 状态：权限批准 / provider retry 的续跑流程
     *      正是「物理轮已结束、回合尚未结束」，在那里发终态会提前结束回合、
     *      让队列再派一轮。
     *   3. 仍 busy —— 已经有 `agent_end` 正常收尾的轮次不再补发，避免 IDLE 自环
     *      污染 turn metrics（`turn-metrics-reporter` 按 AGENT_ENDED 武装上报）。
     *   4. 不在 `COMPACTING` —— 压缩自带 `COMPACT_ENDED` / `COMPACT_FAILED` /
     *      超时 `FORCE_IDLE` 终态，外人不得插手（compact-strategy-base）。
     *
     * 事件选择：保留 `AGENT_ENDED`，**不用 `forceIdle`**。clean ESC 的既有语义就是
     * `AGENT_ENDED` + 读 `abortSignal.aborted` 归类（turn-metrics-reporter），而
     * `FORCE_IDLE` 被刻意排除在指标之外。`PREPARING` / `PENDING` 按转换表拒收
     * `AGENT_ENDED`（防迟到事件把新一轮打回 idle），先走合法的
     * `CANCEL_REQUESTED → CANCELLING` 再终结。
     */
    private convergeCancelledOwnedLifecycle;
    /**
     * 被取消的轮次在物理收尾时释放**自己**在 session 上留下的运行身份令牌。
     *
     * `session.activeRunContext` 是"哪一轮 run 当前持有会话"的身份令牌：
     * agent-factory 在 `agent_start` 写入、在**配对的** `agent_end` 清空
     * （`agent-factory.ts:88` / `:121`），`agent_end` 的 stale 守卫据此丢弃身份
     * 不符的终态（`:114`），防止旧轮的迟到收尾把新轮打回 idle。
     *
     * 缺口：clean abort **不发** `agent_end`——SDK `#runStreamLoop` 在 abort 时
     * `return` 而非 throw（agents-core `dist/run.js`）。于是被 Esc 打断那一轮的
     * 令牌永久滞留，下一轮 run 真实的 `agent_end` 因身份不符被丢弃，状态机收不
     * 到终态；若下一轮是**正常结束**（非取消），收敛逻辑也不介入，会话永久卡忙。
     *
     * 三重守卫，确保只回收本轮自己的垃圾：
     *   1. `ownsLifecycle` —— 只有主轮次写过这个令牌（旁路 generator 被
     *      `drivesStateMachine` 挡在 agent-factory 外，子 agent 用独立 session）。
     *   2. `signal.aborted` —— 正常结束的轮次令牌已由配对 `agent_end` 清掉；
     *      **权限批准等待中**的轮次物理 loop 也会结束，但回合没结束，令牌必须
     *      保留，否则 error-recovery / compact / silentAbort 手动 emit 的旧
     *      `agent_end`（见 `agent-factory.ts` stale-end 守卫注释）会被放行，把
     *      等待中的会话错误打回 idle。
     *   3. compare-and-delete —— 令牌若已被新一轮的 `agent_start` 换掉，绝不碰。
     *
     * 时序安全：`agent_start` 在 stream loop 内发出，本函数在 stream loop 结算
     * 之后才跑，因此"写令牌"必然早于"清令牌"，不依赖任何微任务顺序假设。
     */
    private releaseCancelledRunContextToken;
    protected getPreviousAbortStateByStartupSignal(): WeakMap<AbortSignal, boolean>;
    /**
     * 本轮 startup controller 装上的取消链接的显式摘除句柄，以 link 的 **source
     * signal** 为键（即"谁 abort 时会传播出去"的那一端）。
     *
     * 两类 link 都登记在这里：
     * - upstream signal → 本轮 controller（父→子继承取消）
     * - 本轮 controller → 上一轮未收尾 controller（ESC 级联，见下方 cascade 注释）
     *
     * 存 disposer 不会复发 #82125：`linkAbortSignalToController` 返回的 disposer 只
     * 通过 WeakRef 持有两端，本 WeakMap 因此不构成 `controller_N → controller_{N-1}`
     * 的强引用链。
     */
    private runStartupLinkDisposersBySignal;
    protected getRunStartupLinkDisposersBySignal(): WeakMap<AbortSignal, AbortLinkDisposer[]>;
    private registerRunStartupLink;
    /**
     * 每个 session 里正在执行 pipeline 的各轮 startup signal。
     *
     * 收尾时用它回答"本 session 还有别的轮在途吗"：`run()` 的 finally 只能在**没有**
     * 其他在途轮时摘链，否则会掐断 ESC 通路（见 `disposeRunStartupLinks` 注释）。
     * WeakMap 以 session 为键，会话回收即整条记录消失。
     */
    private inFlightRunSignalsBySession;
    protected getInFlightRunSignalsBySession(): WeakMap<Session, Set<AbortSignal>>;
    private trackInFlightRun;
    /** 摘掉本轮的在途登记，返回本 session 是否**仍有**其他轮在途。 */
    private untrackInFlightRun;
    /**
     * 摘除以 `sourceSignal` 为源的全部取消链接。
     *
     * 两个前提同时成立才调用它：
     *
     * 1. **本轮真的执行过**（`skipRun === false`）。被 MessageQueue 入队的一轮必须把
     *    自己的级联留在原地：它是 `session.abortController` 的当前 owner，而在途的
     *    上一轮还没结束——摘掉级联就等于把 ESC 通路掐断（#101886）。
     * 2. **本 session 已无其他在途轮**。执行过的一轮收尾时上一轮仍可能在跑（两轮真
     *    并发，例如新一轮未被入队却先跑完）。此时 session 的 owner 还是收尾的这一轮，
     *    ESC 只打 owner，级联是够到在途那轮的唯一通路，同样不能摘。
     *
     * 判据 2 **刻意宽判**到"整个 session"，不收紧成"这条链的目标还在途"：`runDefault`
     * 只建外层 startup controller 再调 `run()`，而在途登记只发生在 `run()` 里，所以双层
     * controller 下的外层永远不算"在途轮"——按目标精确判会摘掉 `B_inner → B_outer`，
     * 当场断在 `B_inner → B_outer → A` 的第一跳。要精确就得沿链走可达性，而不是看单跳
     * 目标；宽判的代价只是 session 忙而目标其实已结束时多留一轮链接。
     *
     * 留下的级联不构成泄漏，但也不是零残留：目标真被 abort 时由
     * `linkAbortSignalToController` 的反向清理自摘（Esc 真按下时整条链清干净，传播
     * handler 都是 `once`）；始终没 abort 时则没有任何主动摘除路径——摘除只由"源那一轮"
     * 的 finally 触发，而源已经结束——要等 `session.abortController` 换人后源 signal 不再
     * 可达，连同其监听器一起被 GC 回收（换 owner 本身不做清理）。残留量 O(重叠轮次)，
     * 每轮常数条。
     */
    protected disposeRunStartupLinks(sourceSignal: AbortSignal | undefined): void;
    /**
     * Install a cancellable startup owner synchronously, before the first
     * agent/auth/runner await. User Stop always aborts `session.abortController`;
     * making this controller current closes the otherwise-unobservable window
     * in which a stopped human prompt could later enter interceptors and issue
     * a fresh human-origin lease.
     *
     * When `publish` is `false` (default when a session+lock path will use
     * `installRunStartupController` inside the lock), the controller is created
     * and the upstream link is wired, but `session.abortController/abortSignal`
     * and the previous-controller cascade are **not** touched — those are
     * session mutations that must happen inside the operation lock to avoid the
     * TOCTOU race described in #59319.
     *
     * `publish: true` (or omitting the flag) preserves the legacy behaviour for
     * callers without a lock (new sessions, `runDefault`, `runOneTime`, etc.).
     */
    protected createRunStartupController(session: Session | undefined, upstreamSignal?: AbortSignal, publish?: boolean, collector?: AbortLinkDisposer[], isolatePreviousRunOnCancel?: boolean): AbortController;
    /**
     * Publish a startup controller onto the session: set
     * `session.abortController/abortSignal` and install the previous-controller
     * cascade. Must be called **inside** the operation lock when one exists.
     *
     * Idempotent: if controller is already the session owner, this is a no-op.
     */
    protected installRunStartupController(session: Session | undefined, controller: AbortController, collector?: AbortLinkDisposer[], isolatePreviousRunOnCancel?: boolean): void;
    protected assertRunStartupActive(signal: AbortSignal): void;
    protected waitForPluginRuntimeRefresh(): Promise<void>;
    protected isManagedAgentInstance(agent: Agent): boolean;
    /**
     * Join startup plugin projection after History has persisted the user
     * message. Manager-owned runtimes may then be rebound to the latest full
     * Product generation; derived/per-request Agents retain their exact object.
     */
    protected joinPluginRuntimeRefreshForRun(request: AgentRunRequest): Promise<void>;
    /**
     * Isolate the mutable SDK Agent fields for one dispatch.
     *
     * ModelConfigAgentRunInterceptor writes `model` and `modelSettings` in place.
     * Reusing the manager's cached Agent lets two concurrent sub-agent sessions
     * overwrite each other, so the later model wins for both requests.
     */
    protected isolateManagedAgentForRun(request: AgentRunRequest): Promise<void>;
    /** Create a per-call Agent for direct one-shot paths that bypass interceptors. */
    protected createRunScopedAgent(agent: Agent): Promise<Agent>;
    protected resolveRunOneTimeModel(agentName: string, session?: Session): Promise<LanguageModel>;
    run<TAgent extends Agent<any, any>>(agent: TAgent, input: string | AgentInputItem[], options: AgentCurrentContinuationOptions): Promise<void>;
    run<TAgent extends Agent<any, any>, TContext = Session>(agent: TAgent, input: string | AgentInputItem[] | RunState<TContext, TAgent>, options?: AgentStandardRunOptions<TContext>): Promise<void>;
    private runPipeline;
    /**
     * #59319-stream: 抽取的 physical run cleanup 逻辑。
     * 非 stream 路径由 run() finally 同步调用；
     * stream 路径由 result.completed.finally() 异步调用。
     *
     * 幂等：通过外部传入的 once guard closure 保证 token/inFlight/link 只清一次。
     * 调用方负责构造 `cleanupPhysicalRunOnce` 闭包（见 run() 内部），
     * 避免 stream completed callback + finally 双重调用。
     *
     * #59319-fix: 统一使用实际 `session`（而非 `startupSession`）执行
     * clearLifecycleOwner / lifecycleOwners.has。无 options.context 时
     * startupSession 为 undefined，但 pipeline 会 sessionManager.create()
     * 创建动态 session 并在其上写 lifecycle token；旧代码对 startupSession
     * 守卫导致 token 遗留。
     */
    private performPhysicalRunCleanup;
    private inObservedRunStage;
    private observationRequestId;
    protected resolveAgentForSession(session?: Session): Promise<Agent>;
    /**
     * #59319-A/D: 统一的 run admission 准备。
     *
     * runDefault 和 run 都通过此方法获得 controller + admission 结果。
     *
     * - 创建未发布的 controller（publish=false）。
     * - 有 existing session + lock 时，在 lock 内 install controller + IDLE→PREPARING。
     * - 等待锁期间临时单向 link previous.signal → pending controller（D 修复），
     *   使用户 ESC abort 旧 owner 时传播到等待中的 pending run。取锁后摘除临时 link。
     * - 无 lock / 新 session 保持旧发布路径。
     *
     * @returns controller、admissionResult、previousAbortedAtEntry、cleanupPendingAdmissionLink、cleanupRunLinks、cleanupCascade
     */
    private prepareRunAdmission;
    runDefault<TAgent extends Agent<any, any>>(input: string | AgentInputItem[], options: AgentCurrentContinuationOptions): Promise<void>;
    runDefault<TAgent extends Agent<any, any>, TContext = Session>(input: string | AgentInputItem[] | RunState<TContext, TAgent>, options?: AgentStandardRunOptions<TContext>): Promise<void>;
    /**
     * A one-time agent is an attached child when it reuses a caller Session: it
     * inherits cancellation from the caller and from the foreground owner that
     * existed at invocation time, but never becomes that Session's public owner.
     */
    private createOneTimeAbortScope;
    private oneTimeAbortError;
    private assertOneTimeRunActive;
    /**
     * Streams the text of a one-shot run on `session`. A reused caller Session is shared
     * with its in-flight main run, so the call's purpose and request id live in its async
     * scope instead of on the Session.
     *
     * The API settles only after the runner's **physical** stream loop settles: public
     * text closure (`toTextStream()` ending / `completed`) happens at abort time while
     * the provider stream / tools are still unwinding.
     */
    private streamOneTimeText;
    /**
     * Releases an internally created one-time Session only once its stream loop has
     * physically settled (or never started), so late tool / provider work can still
     * resolve the Session while it unwinds.
     */
    private releaseOwnedOneTimeSession;
    /**
     * 辅助一次性 run（调用方没传 context、由本方法新建 session）复用「当前会话」的信任锚点：
     * 敏感审批锚 `sensitiveGrantSessionId` 与会话级隐私锁定位。
     *
     * Auxiliary one-time runs inherit the main session's sensitive approval anchor so a
     * previously admitted input remains admitted throughout the trusted call chain.
     *
     * 前提：调用发生在该会话的 async 链内（`getCurrent()` 读 ALS，由 SessionMiddleware
     * 每轮 setCurrent）。纯定时器驱动的调用取不到，此时与既有行为一致地不做任何事。
     */
    private inheritGrantsFromCurrentSession;
    runOneTime<TContext = Session>(agentName: string, input: string | AgentInputItem[], options?: NonStreamRunOptions<TContext> & OneTimeRunOptions): Promise<string>;
    runOneTime<TContext = Session>(agentName: string, input: string | AgentInputItem[], options?: StreamRunOptions<TContext> & OneTimeRunOptions): Promise<string>;
    runReviewerOneTime(request: ReviewerOneTimeRequest): Promise<ReviewerOneTimeResult>;
    private reviewerCircuits?;
    private runReviewerModel;
    private runIsolatedReviewer;
    /**
     * Enhanced version of runOneTime that supports per-request overrides
     * for temperature, maxTokens, maxTurns, systemPrompt, and bypassPermissions.
     *
     * Based on runOneTime's direct runner.run + toTextStream pattern,
     * with additional parameter overrides for the Pulse pipeline.
     *
     * @param overrides.bypassPermissions - When true, sets session to BypassPermissions mode,
     *   allowing tools like WebFetch/WebSearch to execute without interactive authorization.
     *   Essential for headless/REST scenarios where user confirmation is not possible.
     */
    runOneTimeWithOverrides<TContext = Session>(agentName: string, input: string | AgentInputItem[], overrides?: {
        temperature?: number;
        maxTokens?: number;
        maxTurns?: number;
        systemPrompt?: string;
        bypassPermissions?: boolean;
        /**
         * Provider stop sequences (OpenAI-compatible `stop`). Passed through
         * `modelSettings.providerData.stop`, which OpenAIChatCompletionsModel
         * spreads onto the request body. Used by the auto-mode classifier
         * Stage 1 (`</block>`) to stop generation at the closing tag.
         */
        stopSequences?: string[];
        /**
         * Force-disable reasoning/thinking for this one call by dropping
         * `modelSettings.reasoning`. Used by the auto-mode classifier (tiny
         * `<block>` output budget — reasoning would starve the visible answer).
         */
        disableReasoning?: boolean;
        /**
         * Explicit reasoning effort for this one-shot call.
         * 'none' disables thinking in the HTTP body (reasoning_effort="none").
         * Other values ('low'/'medium'/'high') set the corresponding effort.
         * Takes precedence over disableReasoning when both are set.
         * Used by title generation to explicitly disable thinking for local models.
         */
        reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
        /**
         * Explicit model id/name/alias for this one-shot run. When provided
         * (and non-empty), it takes precedence over the agent's own model
         * resolution (`AgentManager.getModel`). Used by callers such as the
         * WorkBuddy enhance-prompt flow so the run follows the user's
         * currently selected model instead of the sub-agent's inherited
         * fallback (which could land on a broken custom model).
         */
        model?: string;
        /** Caller opt-in: require an explicit model that resolves to an enabled model. */
        strictModel?: boolean;
    }, options?: NonStreamRunOptions<TContext> | StreamRunOptions<TContext>): Promise<string>;
    /**
     * Run a one-shot agent call in a forked (isolated) session that inherits
     * conversation history from the parent session.
     *
     * Mirrors claude-code's runForkedAgent:
     *   forkContextMessages = getMessagesAfterCompactBoundary(stripInProgressAssistantMessage(context.messages))
     *   initialMessages = [...forkContextMessages, ...promptMessages]
     *   query({ messages: initialMessages, ... })
     *
     * Key properties:
     * - Creates a NEW session (parent's abortController, state, queue untouched)
     * - Processes parent's history through the same pipeline as HistoryAgentRunInterceptor
     * - Concatenates [processedHistory, ...input] as the full message list (like claude-code)
     * - Forked messages are NOT written back to parent
     * - /btw may compact an isolated context snapshot when it is over budget
     * - Token usage is accumulated to parent session for UI display
     * - disableTools strips all tools from the agent (for /btw side questions)
     */
    runForked(agentName: string, input: string | AgentInputItem[], parentSession: Session, forkedOptions?: import('./agent-protocol.js').ForkedAgentOptions): Promise<string>;
}
//# sourceMappingURL=agent-service.d.ts.map