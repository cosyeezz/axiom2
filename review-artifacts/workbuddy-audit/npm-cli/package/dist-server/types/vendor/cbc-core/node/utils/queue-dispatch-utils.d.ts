import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
/**
 * Message queue deferred dispatch utilities.
 *
 * 判定 CLI 运行在消息队列的哪一种派发模式下。这两个简称在本仓消息队列子系统被广泛使用
 * （`acp-view` / `idle-queue-drain-service` / `team-inbox-dispatch-service` /
 * `interruption-service` / `input-interceptors` 等），这里是它们唯一的定义处：
 *
 * **Mode A（默认，product feature 关闭）** —— 队列由 CLI 自己管。用户在 agent 忙时发来的
 * 消息进 `session.queue`，本轮结束后由 `MessageQueueAgentRunInterceptor` /
 * `IdleQueueDrainService` / `InterruptionService` 自动 drain 出去。纯 CLI / TUI 形态。
 *
 * **Mode B（product feature `MessageQueueDeferredDispatch` 开启）** —— 派发权交给客户端。
 * 权威队列是 CLI 内存里的 rich queue（`RichMessageQueueManager`，带 id / 状态 / 顺序，
 * 支持删除、编辑、拖动排序、立即发送），UI 通过 `activateConversationMessageQueue` 一条条
 * 取；CLI **不再自动 drain**。后果有两条，改这块代码前必须知道：
 *  1. `session.queue` 降级为 rich queue 的**展示镜像**（只给 CLI TUI 看），镜像段由
 *     `RichMessageQueueManagerImpl.syncToSessionQueue` 整体重建；
 *  2. 主会话的 legacy 自动 drain 路径被短路。子任务没有客户端派发者，仍由
 *     MessageQueueAgentRunInterceptor 消费非镜像项（包括普通 user 消息）。
 *
 * 因此在 Mode B 下 `session.queue` 是两个所有者共用的数组：镜像段属于 rich queue，
 * 系统注入项（后台任务通知 / channel / teammate / ACP steer 等）属于各自的注入方。任何一方读写它时
 * 都必须只碰自己那部分 —— 见 `isSystemInjectedQueueItem`。
 *
 * Check order:
 *  1. Environment variable `CODEBUDDY_CODE_MESSAGE_QUEUE_DEFERRED_DISPATCH` — if set, wins.
 *  2. Product feature `MessageQueueDeferredDispatch` from product config.
 */
export declare abstract class QueueDispatchUtils {
    static readonly ENV_KEY = "CODEBUDDY_CODE_MESSAGE_QUEUE_DEFERRED_DISPATCH";
    /**
     * `session.queue` 项上标记「这是 rich queue 的展示镜像」的 providerData 键。
     *
     * 由 `RichMessageQueueManagerImpl.syncToSessionQueue` 在构造镜像项时打上，是镜像段的
     * **唯一权威标识**。归属判断必须靠它正向识别，不能用「像不像用户输入」反推 —— 见
     * `isSystemInjectedQueueItem` 的注释。
     */
    static readonly QUEUE_MIRROR_FLAG = "queueMirror";
    /**
     * 判断一条 `session.queue` 项是否属于「系统注入、只能靠自动 drain 消费」的那一类
     * （后台任务通知 / cron 通知 / channel / teammate / isMeta 内部消息）。
     *
     * 存在的理由见类注释：Mode B 下 `session.queue` 是镜像段与系统注入项共用的数组，
     * 双方都必须只碰自己那部分，否则互相抹掉 —— issue #83856 里后台任务通知被镜像同步
     * 整段清空、以及通知 drain 把镜像当用户输入发出去，都是这么发生的。
     *
     * 判据分两步，顺序不能反：
     *  1. **镜像项按自身标记排除**。这一步是必须的：下面那步用的
     *     `InputItemUtils.isEditableQueuedMessage` 里含一条文本启发式
     *     （`/<channel\b/i` 与 `<agent-notification>`），它是 channel 消息的承重识别
     *     机制（channel 消息由 `user(text)` 构造，身上没有任何 providerData），但用户
     *     排队的消息只要文本里出现这两个串，它的镜像项就会被误判成系统注入项 —— 于是
     *     镜像同步会把它当"别人的东西"保留下来、同一次又重新生成一份，`session.queue`
     *     每次 sync 多留一份，并且 drain 会把它当通知发给模型。
     *  2. 其余按 `isEditableQueuedMessage` 的既有判据取反：用户主动输入的纯文本可编辑，
     *     系统注入项（isMeta / skipRun / teammate / channel 文本）不可编辑。
     *
     * Mode A 不需要这个区分：那里 `session.queue` 里的每一项都是待发输入。
     */
    static isSystemInjectedQueueItem(item: AgentInputItem): boolean;
    /**
     * 从 `session.queue` 里挑出「自动 drain 通道」该消费的项。
     *
     * 先丢弃 TaskOutput 已读的完成通知。Mode A：其余整个队列都是待发输入。
     * Mode B 主会话：只返回系统注入项。子任务：所有非镜像项都是真实待发输入。
     */
    static ownedQueueItems(session: Session): AgentInputItem[];
    /** Task runtimes have no client queue dispatcher, including restored child sessions. */
    static isTaskQueue(session: Session): boolean;
    /** The legacy interceptor owns all Mode A input and Mode B task input, never rich mirrors. */
    static usesLocalQueueDispatch(session: Session): boolean;
    static autoDrainQueueItems(session: Session): AgentInputItem[];
    /**
     * Observe which items one drain invocation actually consumed.
     *
     * **`input` is matched by array *identity*, not contents** — a copy observes
     * nothing, and the caller then reads a failed drain as having consumed
     * nothing. Per instance rather than per session because a session-wide
     * snapshot cannot tell this batch apart from a competing run's.
     *
     * @returns disposer; call it once the run settles.
     */
    static observeQueueDrain(input: AgentInputItem[], observer: (items: AgentInputItem[], signal?: AbortSignal) => void): () => void;
    /**
     * Report the items consumed for `input`. No-op when nobody observes that
     * exact array instance — see {@link observeQueueDrain} for the contract.
     */
    static recordQueueDrain(input: AgentInputItem[], items: AgentInputItem[], signal?: AbortSignal): void;
    /**
     * Async check — reads product config when env var is not set.
     */
    static isDeferredDispatchEnabled(): Promise<boolean>;
    /**
     * Sync check — only inspects the environment variable and the already-loaded
     * product config (no async I/O). Safe for hot paths where awaiting is not possible.
     */
    static isDeferredDispatchEnabledSync(): boolean;
    /**
     * Env var controlling whether team inbox messages (teammate SendMessage replies and
     * framework auto-notifications) are auto-dispatched to the team lead after its
     * current turn completes.
     *
     * Default: ON. Set to `0` / `false` / `off` to disable — the messages still land in
     * the rich queue and remain visible in the UI; only the CLI-internal auto-activate
     * is skipped.
     */
    static readonly TEAM_IMMEDIATE_DISPATCH_ENV_KEY = "CBC_TEAM_IMMEDIATE_DISPATCH";
    /**
     * Sync check for the team immediate-dispatch feature flag.
     *
     * Returns `false` only when the env var is explicitly set to a falsy value
     * (`0`, `false`, `off`, case-insensitive). All other values — including "unset"
     * — yield `true`. This is intentionally looser than `BooleanUtils.isTruthy`
     * because we want the feature ON by default.
     */
    static isTeamImmediateDispatchEnabled(): boolean;
}
//# sourceMappingURL=queue-dispatch-utils.d.ts.map