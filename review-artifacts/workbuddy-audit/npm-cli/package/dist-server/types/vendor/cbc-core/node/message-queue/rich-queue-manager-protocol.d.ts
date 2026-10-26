/**
 * Rich Message Queue Manager Protocol
 *
 * Manages a rich, typed message queue in CLI memory for Mode B (MessageQueueDeferredDispatch).
 * In Mode B, the UI drives dispatch via activateConversationMessageQueue;
 * CLI only stores the queue and returns snapshots.
 *
 * session.queue is a pure display mirror of the rich queue for CLI TUI.
 * Consumption (activate, sendNow) always operates on the rich queue directly.
 */
export type RichQueueItemStatus = 'pending' | 'sending' | 'sent' | 'deleted';
export type RichQueuePauseReason = 'cancel' | 'error';
export interface RichQueueRuntime {
    activated: boolean;
    paused: boolean;
    pauseReason?: RichQueuePauseReason;
    inflightItemId?: string;
    awaitingSessionIdle?: boolean;
    immediateItemId?: string;
    lastError?: string;
    updatedAt: number;
}
export interface RichQueueItem {
    id: string;
    conversationId: string;
    contentBlocks: unknown[];
    previewText: string;
    status: RichQueueItemStatus;
    order: number;
    createdAt: number;
    updatedAt: number;
    lastAttemptAt?: number;
}
export interface RichQueueData {
    version: number;
    conversationId: string;
    updatedAt: number;
    runtime?: RichQueueRuntime;
    items: RichQueueItem[];
}
export declare const RichMessageQueueManager: unique symbol;
export interface RichMessageQueueManager {
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
     * #100404：非破坏性地读取待注入的 sendNow 项并拼成模型输入。
     *
     * 不删队列、不清 `immediateItemId`、不落历史、不广播。返回被 peek 的 `ids`，交调用方在
     * `MODEL_REQUEST_STARTED` 之后、`callModelInputFilter` **返回之前**调 `commitConsumed(ids)`
     * 落定消费（该锚点是本地状态机相位迁移，不等于 HTTP 请求已发出——残留窗口见
     * `RunnerFactoryImpl.commitPendingRichConsume` 的 JSDoc）；若本次 filter 没走到 commit
     * （auxiliary / filter 内 abort / turn 收尾），不 commit → 项仍留队列、`immediateItemId`
     * 仍置位，agent_end 时 `TeamInboxDispatchService` 可正常补派发。无内容时返回 undefined。
     *
     * 只认可注入项（斜杠命令需走 idle 命令链路、空文本无内容可注入），过滤前置在摘除之前，
     * 不可注入项原封不动留在队列里（#31965）。
     *
     * **边界：非破坏性 ⇒ 无 run 间互斥语义。** 同一 session 上确实可能出现两个并发主对话 run
     * （`isSessionRunStatusBusyForQueue` 把 `PREPARING` 判为「不忙」，见
     * `session/session-run-state-machine-protocol.ts`），两者都可能 peek 到同一批项。届时同一
     * 条内容出现在两次请求里，后一次 `commitConsumed` 幂等 no-op，净效果是模型多看一遍；
     * 方向上「重复优于丢失」可接受，**不会**造成「消费了却没送模型」。不要把它当互斥原语；
     * 调用方也必须把 ids 当作**调用局部数据**持有，不要放到 session 之类的跨 run 共享位置，
     * 否则一个 run 会 commit 掉另一个 run peek 到的项（#100404）。
     */
    peekAndBuildModelInput(sessionId: string): {
        item: import('../../../cbc-shared/node/index.js').AgentInputItem;
        historyItems: import('../../../cbc-shared/node/index.js').AgentInputItem[];
        ids: string[];
        queue: RichQueueData;
    } | undefined;
    /**
     * #100404：落定 `peekAndBuildModelInput` 的消费——从队列摘除给定 ids，命中则清
     * `immediateItemId`，并同步展示镜像。scoped 到 ids，不影响期间新入队的项。
     */
    commitConsumed(sessionId: string, ids: string[]): RichQueueData;
    /**
     * #100404：是否存在「可注入的 sendNow 项」（纯读，不消费）。用于 keep-alive 续圈
     * 判据（`__codebuddySteerPending`），与 `peekAndBuildModelInput` 用同一套过滤条件。
     */
    hasInjectableSendingItems(sessionId: string): boolean;
    activate(sessionId: string): {
        item: RichQueueItem | undefined;
        queue: RichQueueData;
    };
    pause(sessionId: string, reason?: RichQueuePauseReason): RichQueueData;
    resume(sessionId: string): RichQueueData;
    markItemSent(sessionId: string, itemId: string): void;
}
//# sourceMappingURL=rich-queue-manager-protocol.d.ts.map