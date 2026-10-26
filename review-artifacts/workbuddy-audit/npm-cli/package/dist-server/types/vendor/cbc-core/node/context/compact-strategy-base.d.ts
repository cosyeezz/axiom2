import { type Agent, AgentInputItem } from '../../../cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { AgentManager, AgentService } from '../agent/agent-protocol';
import { HistoryReloadReason, Session, SessionHookManager, SessionManager } from '../session/session-protocol';
import { SessionRunStateMachine } from '../session/session-run-state-machine-protocol';
import { CompactBroadcast } from './context-host-protocol';
import { CompactStrategy, CompactStrategyContext, ContextCompactSummarizeOptions, PromptRenderer, SummaryScenario } from './context-protocol';
import { type CompactSummaryModel } from './pre-switch-model';
/**
 * 压缩策略共享基类，封装 session 状态管理、广播、continue 消息、abort 等基础设施方法。
 * 各具体策略通过继承获得这些能力，只需关注自己的压缩逻辑。
 */
export declare abstract class CompactStrategyBase implements CompactStrategy {
    abstract readonly name: string;
    abstract readonly priority: number;
    protected readonly agentService: AgentService;
    protected readonly productManager: ProductManager;
    protected readonly agentManager: AgentManager;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly sessionHookManager: SessionHookManager;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly stateMachine: SessionRunStateMachine;
    /**
     * Optional: ACP broadcast service for compact-cancelled signal emission.
     * Absent in headless/SDK environments without an attached ACP agent.
     */
    protected readonly acpBroadcastService?: CompactBroadcast;
    abstract canHandle(context: CompactStrategyContext): boolean;
    abstract execute(session: Session, options: ContextCompactSummarizeOptions, context: CompactStrategyContext): Promise<boolean>;
    /** 执行压缩前 hook，并保存其返回的补充压缩指令。 */
    protected notifyPreCompact(session: Session, trigger: 'manual' | 'auto', customInstructions?: string): Promise<void>;
    /**
     * PostCompact 仅用于观察。Hook 失败不能把已成功的压缩改成失败，
     * 也不能阻断压缩后的后续运行。
     */
    protected notifyPostCompact(session: Session, trigger: 'manual' | 'auto', compactSummary?: string): Promise<void>;
    /**
     * Abort current streaming output and wait for session to become idle.
     * This is needed before blocking compaction to prevent further token consumption.
     *
     * 返回是否**真的执行了 abort**：只有当 session 当前持有一个 in-flight 的 stream run
     * （busy + isStream）时才会 abort 并返回 true；session 已 idle（无 run 可掐）时直接
     * 返回 false。调用方据此判断"原 run 是否已被掐死"——若为 true，则调用方**必须**发
     * continue run 接力，不能因 skipContinue 静默返回，否则会话会永久静止（issue #91416）。
     */
    protected abortCurrentStreamAndWait(session: Session): Promise<boolean>;
    /** {@link abortCurrentStreamAndWait} 此刻调用是否会真的 abort 一个在飞 stream run。 */
    protected hasAbortableStream(session: Session): boolean;
    /**
     * 压缩成功后是否应跳过 continue run。
     *
     * `skipContinue` 的隐含契约是「调用方自己持有一个能继续发出的 pending run」，但只有在
     * 压缩**没有真正 abort** 掉那个 run（`didAbortRun=false`）时该契约才成立。一旦 abort 过
     * （见 {@link abortCurrentStreamAndWait} 的返回值语义），继续路径就只剩 continue run，
     * 此时必须无视 `skipContinue` 强制续跑，否则会话永久静止（issue #91416）。
     *
     * 返回 true = 跳过 continue、可直接成功返回；返回 false = 需要发 continue run。
     */
    protected shouldSkipContinueAfterAbort(options: ContextCompactSummarizeOptions, didAbortRun: boolean): boolean;
    /**
     * 把运行态推进到 COMPACTING，让压缩窗口对外表现为 busy。
     *
     * 压缩期间状态若停在 idle，ACP 层给 Xcode 准备的 idle-cancel 兼容 no-op
     * （`AcpView.ignoreCancelForIdleSession`）会把用户的停止请求整体丢弃，并顺带
     * 消费 pendingCancellation，于是压缩结束后的 continue run 完全不知道用户按过
     * 停止，照常续写；UI 侧则同时挂着「用户已取消」和「生成回复中」。
     *
     * 调用前必须已收尾旧主 run（`abortCurrentStreamAndWait`）：只有 idle /
     * agent_running 能进 COMPACTING。返回是否真的进入，其余状态本身仍是 busy，
     * 取消链路照常工作，无需额外补偿。
     */
    protected enterCompactingState(session: Session, reason: string): boolean;
    /**
     * 离开 COMPACTING 运行态。
     *
     * - `ended`：压缩成功、紧接着要发 continue run。COMPACT_ENDED 不属于
     *   `DRAIN_ELIGIBLE_IDLE_EVENTS`，队列不会抢在 continue run 之前 drain。
     * - `failed`：压缩失败或被用户取消，本轮不再续写，改用 COMPACT_FAILED 让排队
     *   的用户消息能在这个 idle 窗口正常派发。
     *
     * 用户取消会先把状态带到 cancelling，此时即便调用方按成功语义收尾也必须走
     * COMPACT_FAILED——cancelling 不接 COMPACT_ENDED，且这一轮本就不该被当成
     * 「压缩完成、马上续写」。
     *
     * 幂等：状态已离开 compacting / cancelling 时直接返回，避免和 cancel 链路末尾
     * 的 forceIdle 安全网互相打出无效转换日志。
     */
    protected leaveCompactingState(session: Session, reason: string, outcome: 'ended' | 'failed'): void;
    /**
     * 将运行态恢复为 idle，并同步通知订阅者，避免后续用户消息被队列拦截。
     */
    protected resetAgentStateToEnd(session: Session, logMessage: string, logLevel?: 'info' | 'warn'): void;
    /**
     * Send "please continue" message after successful compaction.
     */
    protected sendContinueMessage(session: Session, preCompactAgentName?: string, overrideInput?: AgentInputItem[]): Promise<boolean>;
    /**
     * 计算 contextSummary 本次调用的 modelSettings，由调用方经 `runOneTime({ modelSettings })` 传入。
     * 不写共享的 contextSummary agent：serve/daemon 多会话并发压缩时，maxTokens 随会话的
     * 切换前模型变化，写共享实例会被其他会话覆盖。
     *
     * contextSummary 经 `runOneTime` 调用，绕过 ModelConfigAgentRunInterceptor，
     * 因此不会自动获得主 agent 那套采样参数（temperature / maxTokens / reasoning / text 等）。
     *
     * 这里做两件事：
     *   1) 继承主 agent 当前的 modelSettings（temperature、maxTokens、reasoning、text、providerData 等），
     *      使摘要请求与主对话使用一致的模型配置。contextSummary 默认继承主 agent 的模型，
     *      故继承到的 maxTokens 已是该模型经 ModelUtils.getMaxOutputTokens 处理后的值，无需重算。
     *      有切换前模型时，maxTokens 按那个模型重算（继承到的是新模型的输出上限）。
     *   2) 仍缺 maxTokens（模型未配 maxOutputTokens 且未设 CODEBUDDY_CODE_MAX_OUTPUT_TOKENS，
     *      此时主 agent 自身也不写 maxTokens）时，补摘要兜底 24k，避免请求不带 `max_tokens`
     *      让上游网关回退到模型原生输出上限。
     *
     * 失败时返回 undefined，runOneTime 沿用 contextSummary agent 自身的 modelSettings。
     */
    protected buildSummaryModelSettings(summaryModel?: CompactSummaryModel): Promise<Agent['modelSettings'] | undefined>;
    /**
     * 切换后第一次压缩的摘要模型。从历史用量推导；没有、解析不到、或窗口不比当前大时
     * 返回 undefined，调用方保持「用当前会话模型做摘要」。预算按该模型的物理窗口，
     * 不用新模型的档位 override。
     */
    protected resolveSummaryModel(session: Session): Promise<CompactSummaryModel | undefined>;
    /**
     * Render summary prompt template based on scenario.
     */
    protected renderSummaryPrompt(scenario: SummaryScenario, conversationContent?: string): Promise<string>;
    /**
     * Update cooldown timestamp, mark session as having compacted history, and
     * fan out a `historyReloadSubject` notification.
     *
     * 压缩边界入库时已保存当前上下文估算；server 的 input 投影据此推送用量，
     * 此处只负责压缩生命周期与视图刷新。
     *
     * `historyReloadSubject` 仍 emit —— TUI `use-message-groups` 等订阅者依赖
     * 该事件触发 history 视图刷新，删除会破坏现有 UI 行为。
     *
     * 单点统一 sink：auto-compact / `/compact` slash command / PTL recovery 全部经
     * PreMessage / MaxToken / Blocking 策略到达此处，相比分散埋点更不容易遗漏。
     */
    protected markCompactionComplete(session: Session, reason?: HistoryReloadReason): void;
    /**
     * Emit a synthetic result event to unstick a pending ACP forwardingPromise
     * after MaxToken compact is cancelled.
     *
     * Problem context (MaxToken strategy only):
     *
     * MaxToken runs inside a `setImmediate` callback (runner-factory.ts:126),
     * decoupled from the ACP prompt loop. Its `abortCurrentStreamAndWait` aborts
     * the main agent's in-flight model request, producing a result event. The ACP
     * forwardingPromise's `.finally()` handler sees `isCompressing=true` at that
     * moment and enters the `shouldHoldCompressingResult` branch — intentionally
     * keeping the promise pending so that subsequent compact/continue runs' events
     * can still be forwarded through the same promise.
     *
     * When the user then cancels, `cancelSessionRuntimeState` sets
     * `isCompressing=false`, but the forwardingPromise's `.finally()` has already
     * returned (the `shouldHoldCompressingResult` branch executed and exited).
     * No further result event arrives to re-enter the handler, so the promise
     * stays pending forever → `executePrompt` blocks → for-await loop stalls →
     * new user messages `parkInQueue` indefinitely.
     *
     * Fix: push a fresh result onto `session.resultSubject`, which flows through
     * `combineSubject` → forwardingPromise's subscription fires again → this time
     * `isCompressing=false` + `abortSignal.aborted=true` → resolves `cancelled`.
     *
     * Contrast with Blocking strategy: Blocking runs compact via a normal
     * `agentService.run()` which produces its own result events. The continue run
     * also pushes results. So forwardingPromise always gets a chance to resolve
     * on cancellation. MaxToken's `runOneTime` never pushes to resultSubject,
     * hence this explicit nudge is needed.
     */
    protected emitCancelledResultForAcp(session: Session): void;
    /**
     * Get the id of the last history item that has a valid string id.
     */
    protected getLastHistoryItemId(history: AgentInputItem[]): string | undefined;
    /**
     * 降级路径：截断 + 工程压缩（无 LLM）。
     *
     * 在 LLM summary 失败时调用，保证仍能产出一份"已压缩 + 保留必要语境"的内容
     * 写回 history，避免把超长 history 原样塞给下一轮模型请求（会直接 PTL）。
     *
     * 该兜底不发任何模型请求，因此即使 summary 请求本身就超限（PTL 400），也能安全产出。
     *
     * 步骤：
     *   1) 仅保留最近 N 轮真实用户消息（含其后到下一轮 user message 之间的全部 items）
     *      —— N = keepRecentRounds（默认 DEFAULT_FALLBACK_KEEP_RECENT_ROUNDS）
     *   2) 在截断切片上跑一次 HistoryEngineeringCompactor.compact
     *
     * 返回的 compact 内容已由 HistoryEngineeringCompactor 包成 `<cb_summary>`。
     * 失败/无内容返回 undefined，调用方自行决定后续兜底。
     */
    protected truncateAndCompactAsFallback(history: AgentInputItem[], keepRecentRounds?: number): string | undefined;
    /**
     * 从 history 末尾向前找最近 N 条真实用户消息的起点（含），并返回从起点到末尾的切片。
     *
     * "一轮"约定：以一条 real user message 为起点，到下一条 real user message 之前。
     * 因此保留 N 轮 = 保留最后第 N 条 real user message 之后的所有 items（含该条本身）。
     *
     * 若 history 中 real user message 不足 N 条 → 回退保留整段 history。
     * 若 history 中没有 real user message → 返回原 history（让上层兜底逻辑决定）。
     */
    protected takeRecentRounds(history: AgentInputItem[], rounds: number): AgentInputItem[];
    /**
     * Sanitize input items before passing to summary agent via `runOneTime`.
     *
     * `runOneTime` bypasses the interceptor pipeline, so content types that are
     * normally handled by `ImageRehydrationAgentRunInterceptor` (priority 1050)
     * and `ImageFilterAgentRunInterceptor` (priority 850) would reach the
     * OpenAI SDK unprocessed, causing `Unknown content` errors.
     *
     * This method replaces non-standard content block types with text
     * placeholders so the summary agent can process the history safely.
     *
     * Handled types:
     * - `image_blob_ref` in user message content[] and function_call_result output
     * - `input_image` blocks (base64 images are irrelevant for summarization)
     */
    protected sanitizeItemsForSummaryAgent(items: AgentInputItem[]): AgentInputItem[];
    private sanitizeSingleItem;
    private sanitizeContentArray;
}
//# sourceMappingURL=compact-strategy-base.d.ts.map