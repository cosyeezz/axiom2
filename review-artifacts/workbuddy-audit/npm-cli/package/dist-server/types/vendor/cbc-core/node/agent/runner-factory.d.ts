import { type AgentInputItem, type RunConfig, Runner } from '../../../cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { type NotificationInjectionBuffer as INotificationInjectionBuffer } from '../message-queue/notification-injection-buffer-protocol';
import { type RichMessageQueueManager as IRichMessageQueueManager } from '../message-queue/rich-queue-manager-protocol';
import { type SteerInputBuffer as ISteerInputBuffer } from '../message-queue/steer-input-buffer-protocol';
import { SessionManager } from '../session/session-protocol';
import { SessionRunStateMachine } from '../session/session-run-state-machine-protocol';
import { AgentManager, RunnerFactory } from './agent-protocol';
import { AgentLoopTelemetry, AgentQueueOutput, AgentRunObserver, AgentRunSettings, type ModelStepAttachmentProvider as IModelStepAttachmentProvider, RunnerModelProvider } from './agent-runtime-protocol';
import { ToolCallLoopDetector } from './tool-call-loop-detector-protocol';
/**
 * Marker suffix appended to all truncation retry messages.
 * Used by finishReasonErrorInterceptor to detect prior retries across both mechanisms.
 */
export declare const TRUNCATION_RETRY_MARKER = "Do NOT repeat the same oversized tool call. Break it into smaller operations.";
export interface ModelInputMemoryPressure {
    heapUsed: number;
    heapLimit: number;
    headroom: number;
    inputItems: number;
    estimatedInputBytes?: number;
    /**
     * Whether the retained-size walk finished (fully traversed, or provably ≥ the byte budget).
     * `false` means the walk stopped on the node cap with bytes still under budget — the graph is
     * deep/wide but not necessarily large, so `estimatedInputBytes` must NOT drive a rejection.
     */
    estimateComplete: boolean;
    /** Real, content-independent OOM signal: heap is already near its ceiling. */
    heapCritical: boolean;
    reject: boolean;
}
export declare function assessModelInputMemoryPressure(input: AgentInputItem[], heapUsed?: number, heapLimit?: number): ModelInputMemoryPressure;
/**
 * Tool-specific hints for how to decompose a truncated tool call into smaller operations.
 */
/**
 * 四个「参数天然携带大段内容」的工具对应的拆分建议。
 *
 * 导出给 `session/truncation-recovery.ts` 复用：run 末的截断恢复与这里的 run 内
 * 重试必须给出同一套策略，否则同一个 `Write` 截断在两条路上会收到措辞不同的指导。
 * 历史上拦截器侧另有一份更短的副本，#119765 起统一以本表为基准。
 */
export declare const TOOL_SPECIFIC_HINTS: Record<string, string>;
/**
 * Build a truncation retry message with tool-specific decomposition guidance.
 *
 * 同时供 `session/truncation-recovery.ts` 在 run 末恢复时复用，保证两条路径对同一
 * 工具给出一致的拆分建议（#119765）。
 */
export declare function buildTruncationRetryMessage(truncatedToolNames: Set<string>): string;
export declare class RunnerFactoryImpl implements RunnerFactory {
    protected readonly modelProvider: RunnerModelProvider;
    protected readonly logger: Logger;
    protected readonly sessionManager: SessionManager;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly agentManager: AgentManager;
    protected readonly productManager: ProductManager;
    protected readonly settingsManager?: AgentRunSettings;
    protected readonly toolCallLoopDetector: ToolCallLoopDetector;
    protected readonly telemetryService: AgentLoopTelemetry;
    /**
     * Mode B 的队列权威存储。用 @Optional()：headless 等精简变体可能没有装配它，
     * 缺失时 injectSendNowItems 直接跳过，不影响模型请求。
     */
    protected readonly richMessageQueueManager?: IRichMessageQueueManager;
    /**
     * 「立即插入正在执行的一轮」的待插入缓冲（#85193）。用 @Optional()：headless
     * 等精简变体可能没装配。与消息队列彼此独立——队列后续移除后本缓冲独立存在。
     */
    protected readonly steerInputBuffer?: ISteerInputBuffer;
    /**
     * 后台任务完成通知的注入缓冲（#89130）。用 @Optional()：headless 等精简变体可能没装配。
     * 与 steer 缓冲平行但不带 ownerRequestId——通知不属于任何用户请求（详见组件注释）。
     * 仅 Mode B 使用：Mode A 通知仍走 session.queue + 独立 drain 轮。
     */
    protected readonly notificationBuffer?: INotificationInjectionBuffer;
    /**
     * ACP广播服务，用 @Optional()：仅 ACP agent 附着时存在（headless/eval 等可能缺失）。
     * injectSendNowItems 在 turn 内消费 sendNow 项后，用它把更新后的队列快照推给 UI，
     * 否则前端的 sending 态无人清除、永久转圈（#73022）。
     */
    protected readonly acpBroadcastService?: AgentQueueOutput;
    protected readonly modelStepAttachmentProvider?: IModelStepAttachmentProvider;
    protected readonly runObserver?: AgentRunObserver;
    /** Prevent two concurrent model steps from recording the same reminder. */
    private readonly modelStepAttachmentQueues;
    /** Sessions with a deferred emergency compaction already scheduled (see scheduleEmergencyCompact). */
    private readonly emergencyCompactInFlight;
    create(config?: Partial<RunConfig>): Promise<Runner>;
    private assertModelInputCloneHeadroom;
    /**
     * Fire a one-shot emergency compaction for an over-large history so the user's retry can
     * succeed. Deferred + de-duplicated per session; failures are swallowed because the surfaced
     * error already tells the user how to recover. Mirrors checkAutoCompact's non-blocking branch
     * (setImmediate keeps it off the current runner's abort signal). compactAndSummarize has its
     * own session-level lock, so the in-flight set only avoids scheduling redundant callbacks.
     */
    private scheduleEmergencyCompact;
    /**
     * 在每次模型请求前检查是否需要自动压缩。
     * 此时所有工具都已执行完毕，可以安全地触发压缩。
     */
    private checkAutoCompact;
    /**
     * Mode B：把「立即发送」队列项注入正在运行的 turn（#73022）。
     *
     * 调用点在 `callModelInputFilter`（见 `create()`），即**每次模型请求之前**。
     * rich message / notification / drain prompt 仍在这里注入请求副本；真实 steer
     * 由 `continuationInputProvider` 在 `prepareTurn` 前写入 SDK RunState，避免后续
     * 工具 step 从权威状态重建请求时丢失。
     *
     * 注入内容已经进入本次模型请求，无需再为“曾经注入过”强制续圈。只有模型响应期间
     * 新到达、尚未被取出的消息，才由 `__codebuddySteerPending` 在收尾时实时判定是否
     * `run_again`。否则一次性 keep-alive 会跨工具 step 残留，在正常 final 后制造没有任何
     * 新消息的空续圈（#108458）。
     *
     * 仅 Mode B 生效：Mode A 的注入由 `MessageQueueRequestProcessor` 在 HTTP body 层
     * 完成，两者同时跑会重复注入。
     *
     * @returns 本次调用 peek 到的、待落定的 rich-queue 消费 payload；没 peek 到（或本轮
     *   不该消费）时为 `undefined`。这既是给 `create()` 的 **commit 授权**、也是 commit 的
     *   **唯一数据来源**：调用方直接把它传回 `commitPendingRichConsume`，不再自己重新求值
     *   `isMainConversationRun`（该判据依赖可变的 `session.isCompressing`，本函数内的 `await`
     *   期间会被并发的 compact 路径翻真，二次求值会造成「已注入却不落定」的撕裂，详见
     *   `create()` 注释）。payload 与授权同为调用局部值，天然不跨 run 共享。
     */
    private injectSendNowItems;
    /**
     * Drain steer only at the SDK continuation boundary, before it prepares the next model step.
     *
     * The returned model items are installed by the SDK into RunState.generatedItems before
     * `prepareTurn`. This makes steer authoritative input for every later tool/model step instead
     * of an ephemeral `callModelInputFilter` addition. The visible history stays the bare user
     * message; it is admitted exactly once, by the stream consumer, in RunState order.
     */
    /**
     * 与普通 prompt 的图片拦截器同一实现（#140576）：只加工模型输入副本（压缩 / 按模型能力过滤图片），
     * 历史项保留原图。宿主未提供实现（精简变体）时跳过；加工失败按原内容插入，不丢消息。
     */
    private prepareSteerModelInput;
    private resolveSteerModelInputPreparer;
    private takeSteerContinuationInput;
    /**
     * Visible-history + ACP admission of one drained steer group.
     *
     * Ordering is the caller's responsibility (continuation-history-queue.ts); this only performs
     * the writes and must never throw back into the run.
     */
    private admitSteerToVisibleHistory;
    /**
     * #100404：落定来源一（rich queue sendNow）的消费。
     *
     * 由 `create()` 在 MODEL_REQUEST_STARTED 之后、`callModelInputFilter` **返回之前**调用。
     * 只有到这一步才 `commitConsumed`（从队列摘除）+ addHistory + 广播；若本次 filter 调用
     * 没走到这里（auxiliary / filter 内 abort / turn 收尾），payload 随调用栈丢弃、不被
     * commit，队列项与 immediateItemId 原样保留，agent_end 时 `TeamInboxDispatchService`
     * 补派发。
     *
     * **授权与数据都来自 peek 侧的返回值，不是这里重新求值的守卫**：`create()` 把
     * `injectSendNowItems` 返回的 `PendingRichConsume` 原样传进来，非空即授权。
     * 之所以不在调用点二次求值 `isMainConversationRun`：该判据读可变的 `session.isCompressing`，
     * peek→commit 之间的 `addHistory` I/O 让出期内它会被并发 compact（ACP `/compact` →
     * `USER_COMMAND` → `PreMessageCompactStrategy`，**不 abort** 当前 run）翻真，二次求值会让
     * 「已注入、请求照常发出、模型已应答」的这一轮拿不到 commit → 项留队列 + immediateItemId
     * 置位 → agent_end 边界再起一轮 → 同一条队员消息重复投递。按值传递消除该撕裂；非主对话轮
     * 仍在 peek 侧早退拿不到 payload，「A 轮 peek、B 轮 commit」的错配防线不变。
     *
     * **锚点语义要如实理解**：`MODEL_REQUEST_STARTED` 只是本地会话状态机的相位迁移（供
     * spinner / runState，见 `session-run-state-machine.ts`），**不是传输动作**——真正的 HTTP
     * 请求要等 filter 返回后才由 SDK 发起。因此存在一段**已知残留窗口**：filter 返回之后请求
     * 失败（外层 abort / 网关 4xx-5xx / 断流）时，项已摘除、`immediateItemId` 已清，
     * agent_end 边界的补派发判据为假。相对基线（摘除发生得更早、窗口更宽）本改动严格更优、
     * 无回归，且这类失败是**显式错误态**（与 #100404 的静默卡死不同构），故本 PR 接受该窗口。
     * 彻底关闭它需要把 commit 挪到「首个 stream 事件」这个真正的下游锚点
     * （`session/session-manager.ts` 的 `MODEL_STREAM_STARTED`），涉及跨模块反向布线与
     * 事件类型白名单依赖，另开 issue 跟进。
     *
     * **落史顺序反转（显式接受）**：`modelData.input` 的 filter push 顺序是来源一 → 三 → 四，
     * 但来源一的 `addHistory` 推迟到本方法内执行，来源三/四仍在 `injectSendNowItems` 里
     * 就地 addHistory。同一 model step 同时命中多个来源时，history 里队员消息会排在通知
     * 之后，与模型当时看到的输入顺序相反。steer 已在更早的 SDK continuation 边界同时进入
     * RunState 与可见历史，不参与这段反转。下游按 role/type 消费、不依赖交错位置，故接受。
     *
     * at-most-once 由**作用域**保证，不再依赖「commit 前清暂存」这类补偿动作：`pending` 是
     * 单次 `callModelInputFilter` 调用的局部值，每次调用最多把它 commit 一次，也不可能被
     * 另一次调用（另一个 run）读到或改写。
     */
    private commitPendingRichConsume;
    /**
     * 当本次模型请求没有任何注入、且 `modelData.input` 尾部恰是一条 assistant 消息时，
     * 补一条 isMeta 空续跑用户占位项，杜绝「以 assistant 结尾」的请求被网关判 400（#98245）。
     *
     * 为什么定位在这里而不是 provider 层：这是 keep-alive 续圈（`run_again`）与注入
     * `drain()` 之间的 has/drain 竞态收敛点——只有「续圈却没注入到东西」这一路径会让
     * input 停在 assistant final。正常新用户轮 / 成功注入轮尾部都是 user 项，不会命中本兜底。
     *
     * 占位文本对齐 SDK reasoning-only 续跑的语义：告诉模型「继续」，不携带业务内容，
     * 避免污染历史（isMeta + 不落 history）。`_maxTurns` 仍兜住循环上界。
     */
    private appendContinuationStubIfAssistantTrailing;
    /**
     * 当前这次模型请求是否属于主对话（与 Mode A 的守卫保持一致）。
     *
     * `callModelInputFilter` 对**每一次**模型请求都会触发。#100404 后队列消费是
     * 「peek + commit」两段式，本判据**只在 peek 侧求值**：在 `injectSendNowItems`
     * 开头（`peekAndBuildModelInput` 之前）早退。commit 侧**不再求值它**，而是消费
     * peek 侧的返回值作为授权（详见 `injectSendNowItems` 的 `@returns` 与 `create()`
     * 的注释）——因为本判据读可变的 `session.isCompressing`，两端分别求值会被窗口内的
     * 并发 compact 翻真而撕裂。改成单点求值 + 值传递后，「A 轮 peek 放行、B 轮 commit
     * 放行」的错配依然被阻止：非主对话轮在这道早退处就拿不到授权。
     * 若不拦，用户的指令会被压缩摘要、子 agent 或 prompt-suggestion 等辅助调用吃掉，
     * 主对话反而永远收不到。
     *
     * 还被 keep-alive 续圈判据（`__codebuddySteerPending`）复用：续圈判据必须与取出点
     * 同归属维度，否则 auxiliary / subagent 轮会空续圈（见该闭包内的注释）。
     *
     * PreMessage 的 ContextSummary 复用主 Session，但 purpose 已登记为 auxiliary，
     * 会被上方的 isAuxiliaryPurpose 拦住；MaxToken 摘要与 compact 续跑请求同样复用
     * 主 Session，且 `agentName` 不变，必须靠 `isCompressing` 这道门拦住。
     *
     * multi-session（#44317）回归后若 PreMessage 改回临时子 Session，本注释中的
     * purpose 旁路仍应保留为冗余防线。
     */
    private isMainConversationRun;
    /**
     * 快速检查是否需要压缩，不执行压缩本身。
     *
     * 返回 CompactDecision：
     * - compact=false：无需压缩。
     * - compact=true, blocking=false：常规触发，压缩可后台 fire-and-forget，当前请求照常发出。
     * - compact=true, blocking=true：本地估算显示「input + max_tokens 会撞上下文窗口」，
     *   当前请求若照常发出必被网关拒（400），调用方应同步等待压缩完成再放行。
     */
    private shouldCompact;
    /**
     * 危险级判定：本地估算的输入 token 叠加本轮请求将携带的 max_tokens（输出预留）后，
     * 是否会撞破上下文窗口 —— 网关按 `input + max_tokens <= contextWindow` 校验，超出即
     * 返回 HTTP 400。命中即要求调用方**同步**压缩后再发请求，而不是 fire-and-forget。
     *
     * 保守策略：拿不到 budget / maxOutputTokens 时返回 false（退回原有异步压缩行为），
     * 绝不因为估算缺参而误阻塞正常请求。
     */
    private isContextWindowOverflowRisk;
    /**
     * 就地把一个要保留的 call 的 arguments 换成合法 JSON（jsonrepair 修好的、空参归一的、
     * 或不可修复但已有真实反馈而回显原文的），返回改写后的串供调用方接着用。
     *
     * 同时清掉此刻已经**自相矛盾**的 `providerData.discard`。该标记有两个来源：
     * FunctionCallAgentInputItemProcessor 在入库时 JSON.parse 失败会打，
     * TruncatedToolCallInterceptor 在 finish_reason=length 时也会打（其中被 jsonrepair
     * 修好的那些会走到这里）。它的语义是「这条 call 该被舍弃」，而我们此刻正是在**决定保留
     * 它**，两者直接冲突；留着它，任何按 discard 做判断的下游（如
     * HistoryUtils.fillFunctionCallResultHistory 对 message 的处理）都可能得出相反结论。
     *
     * 顺带减少一点噪音：SDK patch 过的 itemsToMessages 会 `Object.assign` 把 function_call
     * 的整个 providerData 拍到发给模型的 assistant 消息上。注意这只是顺带——messageId /
     * model / agent / argumentsDisplayText 等键同样会跟着走，它们是惰性字段、上游不解读，
     * 这里不做处理；真正需要清掉的只有语义已经反转的 discard。
     *
     * 返回一个浅复制的新 item；providerData 仅在需要删除 discard 时 copy-on-write。
     * session.history 与 SDK 传入的原 item 始终保持不变。
     */
    private withRewrittenCallArguments;
    /**
     * SDK callModelInputFilter: called before every model API request within the SDK run loop.
     *
     * When a model response is truncated (finish_reason=length) and produces a function_call
     * with invalid JSON arguments, the SDK's internal run loop automatically retries
     * (next_step_run_again). Without this filter, that retry sends the truncated function_call
     * (invalid JSON) to the model API, which returns 400.
     *
     * This filter first attempts to repair malformed JSON arguments using the jsonrepair
     * library (handling curly quotes, missing commas, truncated output, etc.).
     *
     * Calls that survive repair failure are handled by completion state, not by
     * finish_reason alone — deleting a call that already produced a real result also
     * deletes the feedback the model needs, so the model goes into the next turn unable to
     * see that it ever called the tool or why the call failed, and simply retries verbatim:
     *
     * - Already executed with a real paired result (non-length finish_reason): arguments
     *   are rewritten to valid JSON echoing the original text, and both the call and its
     *   result are kept. The rewrite also keeps ModelRequestProcessor from dropping the
     *   pair at the HTTP layer.
     * - No real result, partial aborted, or skipRun placeholder: removed as before.
     * - Truncated responses (finish_reason=length): removed as before, plus a user
     *   message instructing the model to break the call into smaller operations. This
     *   turns the SDK's automatic retry into a valid, useful request.
     *
     * Scope of the rewrite: this filter opts into the SDK's `preserveInputIdentity` mode,
     * so existing history items arrive by identity and MUST remain immutable. Repairs use
     * item-level copy-on-write and array-level shallow copies; the SDK still creates isolated
     * model/session copies after the filter returns. `session.history` therefore keeps the
     * malformed arguments and we redo the same rewrite on every subsequent turn. Anything
     * reported from this path must be aggregated per turn rather than logged per call.
     */
    /**
     * 模型输入的两步修复，**顺序不能反**：
     *
     * 1. `filterTruncatedToolCalls` 先跑。截断（finish_reason=length）与坏 JSON 的
     *    call 正是「参数半截 + 没有任何 result」那一类；它删掉这些 call 的同时会注入
     *    拆解引导与防循环停止标记。若先按配对摘掉它们，该分支因 `invalidCallIds` 为空
     *    直接早退，模型拿不到任何引导，退回 #75892 那条老路，而且请求本身合法、无错可见。
     * 2. `filterUnpairedToolCalls` 后跑，收掉剩下的孤儿（参数合法但结果丢失、重复 callId、
     *    头部被截断留下的孤儿结果）。本地正文里的孤儿是持久化的，留着每次恢复都被上游 400。
     */
    private repairModelInput;
    private filterTruncatedToolCalls;
}
//# sourceMappingURL=runner-factory.d.ts.map