/**
 * 回合度量上报器（issue #93946）。
 *
 * 在每个「外部用户回合」正常结束后，往 session.history 追加一条 `turn-metrics`
 * 记录，由 chat-view 渲染成 `✔ Worked for 1m 31s · 12.4k tokens`。
 *
 * 语义对齐 codex 的 `Worked for` 分隔线
 * ====================================
 * codex 只在正常完成路径（`on_task_complete`）插入耗时行；中断与报错走
 * `finalize_turn()`，一行时间都不显示——因为那两种情况下没有「成果」，
 * 告诉用户浪费了多久没有帮助，用户此刻需要的是错误信息本身。这里保持一致。
 *
 * 为什么判定这么啰嗦
 * ==================
 * CBC 的状态机在一个用户回合里可能多次落到 IDLE，其中大部分是假结束：
 *
 *   1. ESC 中断**也走 `AGENT_ENDED`**（不发 `CANCEL_REQUESTED`，见
 *      session-run-state-machine.ts 转换表上的注释），所以光看事件类型分不出来，
 *      必须额外读 `abortSignal.aborted`。
 *   2. 自动上下文压缩会先 abort 旧流并手动 emit 一次 agent_end，随后可能再来一次
 *      `FORCE_IDLE`（等 idle 超时），压缩结束后还有 `COMPACT_ENDED`，最后续跑才是
 *      真正的结束——一个回合最多能看到 4 次 IDLE 转换。
 *   3. 后台任务完成后触发的「空运行」也会正常走完状态机，但它不是用户发起的。
 *
 * 对应三道防线：直接判 `event === AGENT_ENDED`（**不能**复用
 * `isDrainEligibleIdleTransition`，它把 `FORCE_IDLE` 也算进去了）、一组同步读取的
 * 中断/压缩标志、以及 `session.currentTurn` 的一次性消费（没有起点就说明这次结束
 * 不属于任何用户回合）。
 *
 * 同步快照 + 延迟结算
 * ===================
 * 这两个要求是冲突的，所以拆成两段：
 *
 *   - 中断/压缩标志**必须在 `AGENT_ENDED` 落地那一刻同步读**。压缩会在随后的
 *     tick 换掉 abortController（compact-strategy-base.ts），延迟读会把
 *     「被压缩掐断」误判成「正常完成」。
 *
 *   - 耗时与 token 结算**必须等历史落定之后**。`AGENT_ENDED` 来自 SDK 的
 *     `agent_end` 事件，而这一轮的模型回复是经 `resultSubject` 的异步管线
 *     （await result.completed → 拦截器链 → addHistory）写进历史的，**在
 *     `AGENT_ENDED` 之后才完成**。token 也是在那条 addHistory 里通过
 *     `UsageAgentInputItemProcessor` 累加进 `session.usage` 的。实测在
 *     `AGENT_ENDED` 的下一个 microtask 读，拿到的是 `tokenDelta=0` 且历史里
 *     还没有 assistant 消息（连带 `status: 'incomplete'` 的报错判定也会失效）。
 *
 * 所以结算走「防抖」：`AGENT_ENDED` 时先武装（记下回合引用与守卫快照），随后
 * 每来一条历史项就把定时器往后推，静默 SETTLE_DEBOUNCE_MS 之后才真正结算。
 * `MAX_SETTLE_MS` 是硬上限，避免后台活动持续刷历史导致无限推迟。
 */
import { Application, ApplicationLifecycle } from '@celljs/core';
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import type { Subscription } from 'rxjs';
import { SessionSettingsHost as SettingsManager } from './session-host-protocol';
import { type Session, type SessionManager as ISessionManager, type TurnMetricsReporter as ITurnMetricsReporter, type TurnStartSnapshot } from './session-protocol';
import { type SessionRunStateMachine } from './session-run-state-machine-protocol';
/**
 * 结算前的静默等待：最后一条历史项落地后再等这么久才结算。
 * 只影响状态条出现的时机，用户无感；取太小会读到未落定的历史。
 */
export declare const SETTLE_DEBOUNCE_MS = 150;
/** 结算的硬上限，防止后台活动持续刷历史把结算无限往后推 */
export declare const MAX_SETTLE_MS = 3000;
/** 跳过上报的原因，只用于日志排查 */
type SkipReason = 'interrupted' | 'compressing' | 'user-initiated-abort' | 'retry-in-progress' | 'no-turn-start' | 'turn-superseded' | 'error-ended';
/**
 * 回合结束瞬间同步采集的判定输入。
 *
 * 这些字段之所以要在同步回调里快照，见文件头「同步快照 + microtask 决策」。
 */
interface TurnEndSnapshot {
    aborted: boolean;
    compressing: boolean;
    userInitiatedAbort: boolean;
    retryInProgress: boolean;
}
/** 已武装、等待历史落定后结算的一次上报 */
interface PendingReport {
    /**
     * `AGENT_ENDED` 那一刻的 `session.currentTurn` 引用。
     * 结算时做**身份比较**：不相等说明期间已经开了新一轮，这条作废。
     */
    turn: TurnStartSnapshot;
    endSnapshot: TurnEndSnapshot;
    /** 武装时刻，用于 MAX_SETTLE_MS 硬上限 */
    armedAt: number;
    timer: ReturnType<typeof setTimeout>;
}
/**
 * 只在交互式 TUI 会话上报。
 *
 * 度量条是给终端界面看的。非交互路径必须放行，否则会改变既有输出契约：
 *   - `--print --output-format json` 会把 session.history 整体序列化进结果数组
 *     （llm-view.ts 的 toSerializableArray），多出来的 `turn-metrics` 项会让
 *     依赖该结构的 SDK 消费方读到未知类型。
 *   - ACP 侧 replay 本来就会把 custom item 过滤掉，写了也画不出来，白白污染
 *     JSONL 与 combineSubject 流。
 *
 * 判定口径与 mcp-validate-middleware 的 `isNonInteractive` 保持一致
 * （`print` / `acp`），另外把 stream-json 双向协议也算作非交互。
 */
export declare function isInteractiveTuiSession(options: Session['options'] | undefined): boolean;
/**
 * 判断这一轮是不是以「错误」收场。
 *
 * CBC 的各条错误路径（模型报错、长度超限、工具异常、中断补写）都统一往 history
 * 写一条 `status: 'incomplete'` 的 assistant 消息，见 model-response-interceptors.ts
 * 与 interruption-service.ts 的多处 `createAssistantMessage(msg, { status: 'incomplete' })`。
 * 所以从尾部找到第一条 assistant 消息看它的 status 即可。
 *
 * 注意不能只看 `history[history.length - 1]`：错误消息后面往往还跟着别的项。
 */
export declare function endedWithError(history: readonly AgentInputItem[] | undefined): boolean;
/**
 * 纯判定函数：给定回合结束快照与起点，决定要不要上报。
 *
 * 抽成纯函数是为了让单测不必搭 DI 容器和 rxjs 时序就能覆盖全部分支。
 */
export declare function resolveSkipReason(snapshot: TurnEndSnapshot, turn: TurnStartSnapshot | undefined, history: readonly AgentInputItem[] | undefined): SkipReason | undefined;
/**
 * 这个跳过原因意味着「这一轮真的结束了」，还是「回合还在继续」？
 *
 * 压缩掐流、工具拒绝后的自动续跑、自动重试都会在回合中途产生一次 `AGENT_ENDED`，
 * 之后还有续跑——回合起点必须留着，否则真正结束时算不出整轮耗时。
 * 用户中断与报错结束则是终点，起点要清掉，免得残留到下一轮把耗时撑大。
 */
export declare function isTerminalSkip(reason: SkipReason): boolean;
export declare class TurnMetricsReporterImpl implements ITurnMetricsReporter, ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    protected readonly sessionManager?: ISessionManager;
    protected readonly stateMachine?: SessionRunStateMachine;
    protected readonly settingsManager?: SettingsManager;
    /** 每个会话的订阅（状态机 + 历史项），按 session.id 去重 */
    protected readonly subscriptions: Map<string, Subscription>;
    /** 每个会话至多一条待结算的上报 */
    protected readonly pending: Map<string, PendingReport>;
    /** sessionSubject 订阅，onStop 时释放 */
    protected sessionSubscription: Subscription | undefined;
    onStart(): Promise<void>;
    onStop(): Promise<void>;
    unregister(sessionId: string): void;
    /**
     * 让出 `session.currentTurn` 槽位，但只在它仍指向这一轮时。
     *
     * 结算延迟到历史落定之后，这期间排队消息可能已经 drain 成新一轮并写入了
     * 自己的起点；无条件置空会把新一轮的起点抹掉，让它结束时拿不到记录。
     */
    protected releaseSlot(session: Session, turn: TurnStartSnapshot): void;
    /**
     * 丢掉内部运行补的、注定没人消费的起点。
     *
     * `ensureTurnStart` 在运行**开始之前**写起点，但内部运行可能压根跑不起来：
     * 空 input 遇到空队列会走 `RUN_SKIPPED`（Mode A 下 IdleQueueDrainService 与
     * BackgroundTaskNotifier 争同一个 idle 窗口，先到的把队列搬空，后到的落空），
     * 运行抛错则走 `RUN_FAILED`。这两条都不发 `AGENT_ENDED`，槽位于是挂在那里，
     * 被下一次内部运行的 `!currentTurn` 守卫复用——那条线就会报出「距上次失败投递
     * 的时长」这种明显偏大的数字。
     *
     * 只清 `internal` 的：用户回合的槽位在压缩 / 待重试时是刻意留着等续跑的
     * （见 isTerminalSkip），按同样规则清掉会让那一轮丢记录。
     *
     * 已 armed 的不动：那说明它已经等到过 `AGENT_ENDED`，结算流程自己会收尾。
     */
    protected discardInternalTurn(session: Session): void;
    protected observe(session: Session): void;
    protected onRunStateChanged(session: Session): void;
    /**
     * 武装一次待结算的上报；重复的 `AGENT_ENDED` 只是把定时器往后推。
     *
     * 这里就把 `currentTurn` 的引用扣下来：结算时用身份比较判断期间有没有开新一轮。
     */
    protected arm(session: Session, endSnapshot: TurnEndSnapshot): void;
    /** 历史仍在落地——把结算往后推，但不越过硬上限 */
    protected onHistoryItem(session: Session): void;
    protected flush(session: Session): void;
    protected report(session: Session, armed: PendingReport): Promise<void>;
}
export {};
//# sourceMappingURL=turn-metrics-reporter.d.ts.map