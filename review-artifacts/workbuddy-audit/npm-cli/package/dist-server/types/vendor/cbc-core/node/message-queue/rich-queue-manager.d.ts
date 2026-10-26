import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { SessionManager } from '../session/session-protocol';
import { type RichMessageQueueManager, type RichQueueData, type RichQueueItem, type RichQueuePauseReason } from './rich-queue-manager-protocol';
export declare class RichMessageQueueManagerImpl implements RichMessageQueueManager {
    protected readonly sessionManager: SessionManager;
    protected readonly logger: Logger;
    private store;
    getQueue(sessionId: string): RichQueueData | undefined;
    saveQueue(data: RichQueueData): void;
    enqueueItem(sessionId: string, contentBlocks: unknown[]): RichQueueData;
    removeItem(sessionId: string, itemId: string): RichQueueData;
    popItemForEdit(sessionId: string, itemId: string): {
        item: RichQueueItem | undefined;
        queue: RichQueueData;
    };
    reorderItems(sessionId: string, orderedIds: string[]): RichQueueData;
    sendNow(sessionId: string, itemId: string): {
        item: RichQueueItem | undefined;
        queue: RichQueueData;
    };
    /**
     * #100404：非破坏性读取「可注入的 sendNow 项」。唯一的 sendNow 取用点
     * （`peekAndBuildModelInput` / `hasInjectableSendingItems` 都走它），摘除由
     * 调用方在请求真正发起后经 `commitConsumed` 单独完成。
     *
     * 只认「真正能被模型消费」的项：斜杠命令需走 idle 时的命令链路、不能作为普通文本
     * 发给模型，空文本（纯图片项）也无可注入内容。这道过滤必须**前置在摘除之前**：
     * 若先摘除再让调用方过滤，这些项会被摘走却没人用 —— 既没进模型、也没进历史、
     * 也不在队列里，用户消息静默消失（#31965）。不可注入项原封不动留在队列里
     * （对齐 Claude Code `query.ts` 的 `isSlashCommand` 前置过滤）。
     */
    private peekInjectableSendingItems;
    hasInjectableSendingItems(sessionId: string): boolean;
    commitConsumed(sessionId: string, ids: string[]): RichQueueData;
    activate(sessionId: string): {
        item: RichQueueItem | undefined;
        queue: RichQueueData;
    };
    pause(sessionId: string, reason?: RichQueuePauseReason): RichQueueData;
    resume(sessionId: string): RichQueueData;
    markItemSent(sessionId: string, itemId: string): void;
    /**
     * 非破坏性读取待注入的 sendNow 项并拼成模型输入（#100404）。
     *
     * 只做「读 + 文本拼接」，**不删队列、不清 immediateItemId、不落历史、不广播**。
     * 返回被 peek 的 `ids`，交调用方在 MODEL_REQUEST_STARTED 之后（`callModelInputFilter`
     * 返回之前）调 `commitConsumed(ids)` 落定。无可注入内容时返回 undefined。
     *
     * **边界：本方法非破坏性，不提供任何 run 间互斥语义。** 同一 session 上确实可能出现两个
     * 并发的主对话 run（`isSessionRunStatusBusyForQueue` 把 `PREPARING` 判为「不忙」，见
     * `session/session-run-state-machine-protocol.ts`），两者都可能 peek 到同一批项。届时
     * 同一条内容会出现在两次请求里，后一次 `commitConsumed` 被幂等吞掉，净效果是模型多看
     * 一遍——方向上「重复优于丢失」可接受，**不会**造成「消费了却没送模型」。不要把它当作
     * 互斥原语使用；调用方也必须把 peek 到的 ids 当作**调用局部数据**持有，不要存到 session
     * 之类的跨 run 共享位置，否则一个 run 会 commit 掉另一个 run peek 到的项（#100404）。
     */
    peekAndBuildModelInput(sessionId: string): {
        item: AgentInputItem;
        historyItems: AgentInputItem[];
        ids: string[];
        queue: RichQueueData;
    } | undefined;
    private getOrCreate;
    private ensureRuntime;
    private createDefaultRuntime;
    private snapshot;
    private nextOrder;
    private extractPreviewText;
    /**
     * Full sync: mirror all rich queue items to session.queue for CLI TUI display.
     *
     * 镜像只拥有「用户输入」那一段。`session.queue` 里还并存着系统注入项（后台任务
     * 通知、channel / teammate 消息等），它们由各自的注入方拥有、靠自动 drain 消费
     * —— 见 `InputItemUtils.isEditableQueuedMessage` 的契约以及
     * `MessageQueueManagerImpl.popAllEditable`「不可编辑项保留在队列里继续被自动
     * drain」。所以这里只能重建镜像段，必须原样保留系统注入项：整段清空会把待投的
     * `<task-notification>` 物理抹掉，后台任务在模型视角永远停在「运行中」（#83856）。
     *
     * 镜像项带 `QUEUE_MIRROR_FLAG` 自证身份。归属判断**必须**靠这个正向标记，不能靠
     * 「像不像用户输入」反推：`isEditableQueuedMessage` 里那条 `/<channel\b/i` 文本
     * 启发式是 channel 消息的承重识别机制，但会让"用户排队的消息文本里含 `<channel`"
     * 被误判成系统注入项 —— 那样这里就会把它当"别人的东西"保留、同时又重新生成一份，
     * 每次 sync 多留一份，队列无界增长。
     */
    private syncToSessionQueue;
    private getSessionSync;
    /**
     * Check if message text is a slash command (e.g. /commit, /review-pr).
     * Also handles <channel> wrapped messages where the command is inside the tag.
     */
    private isSlashCommand;
    /**
     * 该队列项能否作为普通用户消息发给模型。
     * 斜杠命令需经命令链路执行（含 agent 切换等副作用），不能当文本丢给模型；
     * 空文本（例如纯图片项）也没有可注入内容。两者都应留在队列等正常派发。
     */
    private isInjectable;
    private contentBlocksToString;
}
//# sourceMappingURL=rich-queue-manager.d.ts.map