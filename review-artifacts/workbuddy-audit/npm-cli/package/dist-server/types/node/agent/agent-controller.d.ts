import { AgentCompletionWaiter, AgentManager, AgentService, type RunRequest, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { SettingsManager } from '../settings/settings-protocol';
/** `session.resultSubject` 承载的轮次结果（SDK 的 RunResult / 流式句柄）。 */
type SessionRunResult = Session['resultSubject']['value'];
export declare class AgentController {
    /**
     * Standard HTTP headers that should be filtered out
     * Only custom/extension headers will be preserved for model requests
     */
    private static readonly STANDARD_HEADERS;
    protected readonly agentService: AgentService;
    protected readonly sessionManager: SessionManager;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    protected readonly completionWaiter: AgentCompletionWaiter;
    protected readonly settingsManager: SettingsManager;
    /**
     * stdio stream-json 长轮询旁路（B1）的 park 超时。到点返回空响应让客户端重开一条，
     * 避免长轮询无限挂起、也让心跳/断线可控。
     */
    private static readonly DRAIN_WAIT_TIMEOUT_MS;
    /**
     * 等待「被入队 prompt 自己那一轮」出现的上限（见 `awaitOwnTurnResult`）。
     * 排队期本就可能很长（要等上游那一轮跑完，调用方自己也在等），所以取一个远大于
     * 常规轮次的值；它只用来兜住「永远轮不到」的异常态，不是正常路径。
     */
    protected readonly queuedTurnResultTimeoutMs: number;
    /**
     * 把客户端随本条 prompt 透传的自定义 header 写入本轮 session，供 ModelProvider 在每次
     * 出站模型请求时转发到 model gateway。安全约束：
     * - 仅来源于 stream-json `_meta['codebuddy.ai'].customPassthroughHeaders`（不复用 loopback
     *   HTTP header 的 filterHeaders denylist——那是另一条通道）。
     * - 经启动期前缀白名单 `CODEBUDDY_PASSTHROUGH_HEADER_PREFIXES`（默认空 ⇒ 功能关闭）过滤
     *   （见 passthrough-header-policy）；前缀即安全边界，部署方须选与内部 `X-*` header 命名
     *   空间不相交的前缀。
     * - **每轮 set-or-clear**：不带该字段的后续 prompt 不会继承上一轮的值，保证 per-turn 语义。
     *   本 slot 只归本特性所有且 run() 每轮执行一次，故无需 finally 恢复。
     */
    private applyCustomPassthroughHeaders;
    private applyPrivateDataStickyFromPrompt;
    /**
     * Filter and keep only custom/extension headers
     * Standard HTTP headers are filtered out
     */
    private filterHeaders;
    /**
     * GET /agent/models
     *
     * Returns the list of available models for the default agent.
     * Used by Desktop UI to populate the model selector before a session is created.
     */
    getModels(): Promise<{
        models: Array<{
            id: string;
            name: string;
            description?: string;
            _meta?: Record<string, unknown>;
        }>;
    }>;
    run(request: RunRequest, headers: Record<string, string>): Promise<Session>;
    /**
     * 被入队的 prompt：挂起本请求，直到**它自己那一轮**的 result 句柄出现。
     *
     * print/stream-json 的契约是「一条 prompt 进、这条 prompt 的结果出」。入队那一刻
     * `resultSubject` 里还是上一轮的 result，此时返回会让 view 拿它当本条的结果渲染，
     * 而本条真正的回答稍后由 drain 起的那一轮产出时已无渲染者、被静默丢弃。
     *
     * 等到自己那一轮的句柄再返回即可两面兼顾：`runner.run` 一开跑就把**流式**句柄
     * `resultSubject.next()` 出来（早于内容产出），因此 view 绑到的是本条自己那一轮，
     * 流式内容与终态都在，PrintDeliveryLifecycle 也照常 settle。
     */
    protected awaitOwnTurnResult(session: Session, ownResult: Promise<NonNullable<SessionRunResult>>): Promise<boolean>;
    /**
     * 处理 stdio stream-json 的 drain-wait 长轮询请求（B1 旁路）。
     *
     * @returns true  → 需要走正常 StreamJsonView 渲染（本轮确实发起了 drain-run）
     *          false → 已在本方法内直接写空响应并 end，调用方应返回 undefined 阻止 view 渲染
     */
    private handleDrainWait;
    /**
     * 发起一次 drain-run，并回答「这一轮真的跑起来了吗」。
     *
     * 为什么发起前的 `canDrainNow` 不够：它只在**派发之前**看一眼状态机，挡不住这个窗口
     * ——检查通过之后、拦截器做决策之前，一条真实 prompt 抢先把 session 推离 idle，于是这条
     * 空 input 的 drain-run 照样被 `skipRun`（input-interceptors 的队列路由），一个队列项都
     * 没消费、也没产出自己的 RunResult。
     *
     * 这时若仍返回 true 让调用方走正常渲染，`StreamJsonView.render` 会从 `resultSubject`
     * 绑到**上一轮**那条早已 completed 的 RunResult，再靠它的「漏结束补发」把上一轮的结束
     * 当成本轮的结束写到 stdout。下游 sandbox-proxy 见到 `type=result` 立刻发 endTurn 收流，
     * 刚进来的那条真实 prompt 于是只剩 query、没有 response（现场：第二条 prompt 写入 229ms
     * 后就冒出一条 `duration_ms=29280` 的 result，而真正的回答 34 秒后才生成，已无处可去）。
     *
     * 判据取 `resultSubject` 的**对象身份**，而不是再查一次状态机：被 `skipRun` 的 run 在
     * `runner.run` 之前就返回，永远不会 `resultSubject.next`，所以「引用没变」是「这一轮没
     * 产出」的直接证据，不依赖任何时序假设。真跑起来的 drain 必定推入一条新的 RunResult，
     * 行为逐字节不变。
     *
     * 没产出时走的是本方法族既有的安全出口：写空响应、返回 false，客户端据此重开一条新的
     * 长轮询，队列项由 `IdleQueueDrainService` / `BackgroundTaskNotifier` 的 idle 重投兜底。
     */
    private dispatchDrainRun;
    /**
     * 本轮 drain-run 现在能否真正跑起来并消费掉队列项。
     *
     * 判据取 `isIdle`，与**发起 drain 的那一族**完全同源：
     * - `BackgroundTaskNotifier.scheduleDrain` 用 `isBusy` 双重把关，其
     *   `dispatchDrain` 注释明写「调用方已确认 session 活着、idle、未 abort」
     *   （background-task-notifier.ts:375/383/390）；
     * - `BackgroundTaskNotifier.tryIdleRetry` 用 `isIdle`（background-task-notifier.ts:491）；
     * - `AcpView` 的同族 drain 循环同样用 `isIdle`（acp-view.ts:2007）。
     *
     * 刻意**不用** `isBusyForQueue`：那是 `MessageQueueAgentRunInterceptor` 的**队列路由**
     * 判据，它把 `PREPARING` 当作不忙，目的是避免首个真实请求在启动期被误入队
     * （session-run-state-machine.ts:236-238）。drain-wait 是后台旁路，语义相反——另一个
     * 真实 prompt 已进入启动期时，它必须让路，而不是抢先发起空 drain 去争
     * `session.queue` 与 `abortController`。
     *
     * 为什么这个前提不可省：queue-busy 期间的空 input drain-run **必定**被拦截器
     * `skipRun`（input-interceptors.ts:90-98），不消费任何队列项，却仍会走
     * `AgentService.runDefault` → `createRunStartupController`，后者在拦截器决策**之前**
     * 就无条件改写 `session.abortController` / `abortSignal`（agent-service.ts:165）。而
     * 该 controller 的身份正是 `agent-service.ts:548 newerPhysicalRunOwnsSession` 判断
     * 「是否有新 physical run 接管」、以及 skipRun 安全网决定要不要 `forceIdle` 的权威依据。
     * 一旦某轮 run 卡在非 idle 态，队列不再下降、快路径每次长轮询都命中，客户端 500ms 就
     * 重开一条（cli-executor.ts:530），该判据被持续污染 → 卡住的 run 再也无法被安全网收回
     * idle，用户 Stop 已 abort 的 controller 也会被顶掉。
     *
     * 只加前提、不改 drain 本身：可 drain 时行为逐字节不变。busy 期的队列项不会丢——
     * `IdleQueueDrainService` 在 `agent_end` 后兜底 drain（idle-queue-drain-service.ts:84），
     * `BackgroundTaskNotifier` 另有常驻 idle 重投。
     *
     * 用协议级纯函数而不注入 `SessionRunStateMachine`：协议明确要求两者保持一致
     * （session-run-state-machine-protocol.ts:143-152），且避免给 controller 增加硬 DI
     * 依赖——精简/测试容器未装配该组件时会导致整个 controller 实例化失败。
     */
    private canDrainNow;
    /** 解析 StreamJsonDrainTrigger（可选：ACP/纯 print 等模式下可能未注册）。 */
    private resolveDrainTrigger;
    /**
     * drain-wait 无事发生（超时/冲突）时的空响应：不写任何 NDJSON 消息，直接以
     * stream-json content-type 结束。客户端 handleStreamResponse 收到 end 即 resolve，
     * 立刻重开下一条长轮询。
     */
    private writeEmptyDrainResponse;
}
export {};
