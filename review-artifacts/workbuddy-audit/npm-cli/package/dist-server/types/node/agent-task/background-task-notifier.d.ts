import { AgentService, type BackgroundTask, MessageQueueManager, type NotificationInjectionBuffer as INotificationInjectionBuffer, Session, SessionManager, SessionRunStateMachine } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { SettingsManager } from '../settings';
import { AcpDrainTrigger, BackgroundTaskNotifier, StreamJsonDrainTrigger } from './agent-task-protocol';
/**
 * 把后台 bash/powershell 任务的完成事件，主动推送给主 agent。
 *
 * 设计与 `CronSchedulerServiceImpl` 对齐：
 * 1. 复用 `MessageQueueManager.enqueueMessage` —— 这是 codebuddy 唯一一条
 *    "外部事件 → 主 agent"的消息通道。
 * 2. `isMeta=true` —— 跳过 SystemReminder 注入，对齐 cron 通知样式。
 * 3. idle 时 `queueMicrotask` 触发一次 drain（ACP / stream-json / 空数组 runDefault）。
 *    多个 task 在同一 tick 完成时由 `drainPending` 合并成一次 run。
 * 4. Mode A 的 busy 情形交给 interceptor / `IdleQueueDrainService` 在下一轮合并；Mode B
 *    下这些兜底全被短路，必须自己挂常驻 RunState 订阅反复补投（详见 `ensureIdleRetry`）。
 *
 * 与 Claude Code 的差异（已记录在 commit message）：
 * - 不做 "N background commands completed" 折叠（CC 是 UI 层折叠，不影响模型上下文，
 *   未来如果出现刷屏问题再加）
 * - 不做 stall watchdog（独立 feature，后续 PR）
 * - 不通过 SDK system event 通道（codebuddy print 模式直接拒绝 run_in_background）
 *
 * ACP 模式支持：
 * - ACP 模式下 `triggerEmptyRun` 绕过了 AcpView 的 `for await` 循环，
 *   没有 `createEventForwardingPromise` 覆盖，模型响应事件不会被转发给客户端。
 * - 解决方案：注入 `AcpDrainTrigger`（由 AcpView 实现），ACP 模式下通过
 *   prompt 迭代器推入内部 drain item，复用 `drainQueuedMessages` 的事件转发链路。
 */
export declare class BackgroundTaskNotifierImpl implements BackgroundTaskNotifier {
    protected readonly messageQueueManager: MessageQueueManager;
    protected readonly stateMachine: SessionRunStateMachine;
    protected readonly logger: Logger;
    protected readonly acpDrainTrigger?: AcpDrainTrigger;
    protected readonly streamJsonDrainTrigger?: StreamJsonDrainTrigger;
    /**
     * 后台通知注入缓冲（#89130）。Mode B 下通知进这里而非 session.queue：busy 期由正在跑的
     * 真实轮 mid-turn 注入（runner-factory 来源三），idle 期作为非空 input 起轮
     * （ACP drainBackgroundTaskNotifications 从缓冲取）。用 @Optional() 容错精简变体。
     */
    protected readonly notificationBuffer?: INotificationInjectionBuffer;
    /**
     * 仅用于写「后台任务完成耗时行」（见 {@link appendCompletionMetrics}）。
     *
     * 用 `@Autowired` 而非懒解析是有意的：这确实闭合了一个环
     * （SessionManager → ToolManager → Tool[] → BashTool → 本类 → SessionManager），
     * 但 CellJS 把 `@Component` 的 Symbol 绑成 `toDynamicValue`，inversify 的解析计划
     * 遇到这类绑定就停止下探，环进不了静态循环检测。同形态的更短的环
     * （SessionManagerImpl ⇄ ToolManagerImpl）已在生产运行。
     *
     * **约束：只能在方法体里用**——再入解析时拿到的是同一个对象，但那一刻它自己的
     * 属性注入未必跑完，构造函数 / 字段初始化器里用会读到空引用。
     */
    protected readonly sessionManager?: SessionManager;
    protected readonly settingsManager?: SettingsManager;
    /**
     * 同 tick 内多个 task 完成时合并 drain，避免触发多次空数组 run。
     * 以 sessionId 为粒度——不同 session 的 drain 必须独立。
     */
    private drainPending;
    /**
     * 常驻的 idle 重投订阅，每个 Session 最多一条。见 `ensureIdleRetry`。
     */
    private readonly pendingIdleRetry;
    notifyCompletion(task: BackgroundTask, session: Session, options?: {
        deferDrain?: boolean;
    }): void;
    /**
     * 往对话流写一条「后台任务完成耗时」，渲染为 `✔ Worked for 2m 20s`。
     *
     * 为什么需要：后台任务完成此前在对话流里**完全不可见**——通知是 `isMeta` 消息
     * 界面不渲染，而 `<task-notification>` XML 里也没有时长字段，模型自己同样不知道
     * 任务跑了多久。这个数字原本只能按 ↓ 进任务面板才看得到。
     *
     * 复用 `turn-metrics` 项而不是新增类型：展示形态与回合耗时行本来就要求一致，
     * 复用后渲染组件、时长格式化与 `showTurnDuration` 开关全部共享，对 stream-json /
     * ACP / SDK 消费方的数据形状零影响。两者靠 `source` 字段区分——它同时决定了
     * 这一行不带 `· N shells still running` 后缀。
     *
     * 失败安全：整段自吞异常。写历史失败**绝不能**影响通知投递，否则会退化成
     * issue #83856 那类「后台任务跑完了主 agent 不知道」的静默故障。
     */
    private appendCompletionMetrics;
    notifyEvent(session: Session, xml: string): void;
    /**
     * `notifyCompletion` / `notifyEvent` 共用的入队 + drain 调度逻辑。
     *
     * @param deferDrain 只入队不调度。**注意这不是"稍后一定会投"的承诺**——它连
     *   `ensureIdleRetry` 都不挂，所以这条通知会一直等到下一次有人真正起轮（用户输入、
     *   别的后台任务完成、Mode A 的 interceptor 兜底）才被 drain 走。这正是"用户点删除
     *   不该自己烧一轮对话"想要的语义。
     */
    private enqueueAndScheduleDrain;
    /**
     * 拼装 `<task-notification>` XML。字段顺序对齐 Claude Code（task-id / status /
     * summary / output-file），方便未来共享解析逻辑。
     *
     * Summary 文案区分 toolName，让模型一眼看出是 Bash/PowerShell；status=killed 时
     * 标注"was stopped"，以便模型知道这是显式 kill 不是 process crash。
     */
    private buildNotificationXml;
    /**
     * 尾部的"行动指引"。这段是整条通知里唯一直接指挥模型下一步的内容，也是最容易
     * 出错的地方——LLM 对末尾几行的注意力最高。
     *
     * 按结束原因分支，而不是所有终态共用一套话术：`killed` 同时覆盖「用户取消」
     * 「输出超限被强杀」「会话中断」，它们要求的下一步截然相反。
     *
     * 只说"输出去哪取"和"这条通知是什么"，不替模型判断下一步该做什么——要求模型
     * 回看原始请求、"原始指令优先"的话术已删除（#133018），它会让模型自行加戏。
     */
    private buildGuidanceLines;
    /**
     * 这个任务的退出码是否不可信——即 `completed` 这个状态是猜出来的，不是收到退出码
     * 算出来的。
     *
     * 额外要求 `status === 'completed'` 是一道防御：`kill` 之后终止事件丢失、由句柄
     * 兜底收口，是这条路径最常见的形态，于是 `exitStatusUnknown` 会和 `killed` 大量
     * 共存。而对一个用户主动停掉的任务说"退出码没采集到，请看输出判断成功与否"是误导——
     * 他知道是自己停的。置位口径见 {@link BackgroundTask.exitStatusUnknown}，这里再拦一层。
     */
    private isExitStatusUnknown;
    private buildSummary;
    requestIdleRetry(session: Session): void;
    /**
     * 本通道拥有、还等着投递的排队项数量，用于常驻 idle 重投判定「还有没有要发的」。
     *
     * Mode B（#89130）：通知在 NotificationInjectionBuffer，读它。**不能**读
     * `session.queue`——Mode B 下通知已不进 session.queue，而 session.queue 里可能有
     * rich queue 的展示镜像（用户输入），读它会误判成「还有通知」，把用户排队消息提前投给模型。
     * Mode A：通知仍在 session.queue，读 `QueueDispatchUtils.ownedQueueItems`。
     */
    private pendingNotificationCount;
    /**
     * idle 时主动触发一次 drain；busy 时挂上常驻 idle 重投（`ensureIdleRetry`）。
     *
     * 为什么用 queueMicrotask 而不是同步调用：
     * - notifyCompletion 是从 bash-tool 的 .then/.catch/.finally 链路调进来的，
     *   此时 ToolCall 可能还在结算中，state machine 状态未必已经回 IDLE。延后到
     *   微任务能让当前 reactive chain 收尾。
     * - 同时多个 task 完成时通过 drainPending 合并，避免重复 run。
     *
     * busy 检查刻意排在 drainPending 之前：已排了微任务但在它执行前会话又变 busy 时，
     * 这个顺序保证后到的通知走 ensureIdleRetry 分支而不是被 drainPending 静默吃掉。
     *
     * 无论走哪条分支都会 `ensureIdleRetry`：投递本身可能静默失败（ACP 的 triggerDrain 有
     * 多条 warn-and-return 分支、stream-json 可能没有 parked waiter、drain 轮次也可能被
     * 打断），常驻订阅是这些失败的统一兜底。
     */
    private scheduleDrain;
    /**
     * TUI 先开、Web 后挂上时 `options.acp` 往往仍是 false，但 `meta.acpConnectionId`
     * 已经写好。只看 options 会把唤醒投进 TUI 空 run / Mode B 死缓冲，Web 永远看不到
     * `<task-notification>`。
     */
    private isAcpAttachedSession;
    /** 按宿主形态把 drain 请求投出去。调用方已确认 session 活着、idle、未 abort。 */
    private dispatchDrain;
    /**
     * Mode B 无 ACP 通道、或 ACP triggerDrain 未注入时：从缓冲取出通知当非空 input 起轮。
     * 投递失败必须 push 回去，否则 pendingNotificationCount 变 0，idle 重投再也补不了。
     */
    private deliverBufferedNotificationRun;
    private triggerNotificationRun;
    /**
     * fall-through 轮（triggerEmptyRun / triggerNotificationRun）成功送达后的 ACP 收尾。
     *
     * 这轮不经过 AcpView 的 drain 链路，没有 session_end 收尾帧，Web UI 输入框可能
     * 一直停在 running。委托给 AcpDrainTrigger（AcpView）：能解析到绑定本会话的
     * AcpAgent 就补发与正常 drain 轮相同的 session_end，解析不到（纯 TUI）时 no-op。
     * 只在投递成功后调用——失败路径已回灌，收尾帧会误导客户端以为这轮结束了。
     */
    private notifyAcpFallThroughCompleted;
    /**
     * 挂一条**常驻**的 idle 重投订阅：每次合格 idle 都重新尝试投递，直到本通道的待投项
     * 被消费干净；session 释放时 `runStateSubject.complete()` 自动收尾。
     *
     * 为什么需要（#89130 后）：Mode B 下 busy 期完成的后台任务通知进
     * `NotificationInjectionBuffer`，主要由正在跑的真实轮 mid-turn 注入（runner-factory
     * 来源三）。但存在一个边界——busy 期完成通知、且其所在轮就是最后一轮（之后再无用户
     * 输入 / 后台任务）时，没有新的 model step 来 drain 它。常驻订阅补上这个洞：轮结束
     * 落到合格 idle 时，`pendingNotificationCount` 读 buffer 发现还有通知，触发 dispatchDrain
     * 起一次真实轮把它送达。这也覆盖投递静默失败（ACP `triggerDrain` 的 warn-and-return
     * 分支、stream-json 无 parked waiter、drain 轮次被打断）的重试。
     *
     * 为什么常驻而不是一次性：投递可以静默失败，一次性语义会把唯一的重试烧掉。形态对齐
     * 同仓 `IdleQueueDrainService`。
     *
     * 为什么只在 Mode B 挂：Mode A 通知走 session.queue，`IdleQueueDrainService` /
     * interceptor 兜底已在。再挂一个 drainer 会在同一次 transition 上并发触发多余的空
     * drain run。Mode B 的 TUI / ACP-miss 路径由 `deliverBufferedNotificationRun` 投递。
     */
    private ensureIdleRetry;
    /**
     * 常驻订阅的每次判定。任何一项 guard 不过就静默跳过，**不拆订阅**——下一次合格
     * transition 还要再试。只有会话换代才拆（那条订阅已经属于上一代）。
     */
    private tryIdleRetry;
    /**
     * 会话卸载/换代：拆掉本代的 idle-retry 订阅。abort **不**触发本方法
     * （#83856：abort 保订阅等 resume）。单进程单主会话世界里 WeakMap 键
     * 天然随对象回收兜底，这里提供显式拆点供释放路径与测试使用。
     */
    evictSession(session: Session): void;
    private teardownIdleRetry;
    private triggerEmptyRun;
    /**
     * 解析 AgentService。提取出来便于测试覆盖（避免触碰 ContainerUtil）。
     * 不通过 `@Autowired` 是为了和 `AgentService → BackgroundTaskNotifier` 之间
     * 可能形成的循环依赖解耦——延迟到使用时再解析。
     */
    protected resolveAgentService(): AgentService;
}
