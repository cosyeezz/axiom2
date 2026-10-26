/**
 * Web UI follow-up queue（Mode A `session.queue`）。
 *
 * WorkBuddy Desktop 走 Mode B rich queue，不走这套方法。
 * 仅 `webUiAcp` 会话：忙时入队 / 列表 / 排队项立即发送。
 */
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
export declare const FollowupQueueService: unique symbol;
/** ACP `session_info_update._meta` 键。Web UI 只认这个，避免和 Mode B `message_queue_update` 混读。 */
export declare const FOLLOWUP_QUEUE_META_KEY = "codebuddy.ai/followupQueue";
/** `providerData` 上的稳定 id，供删除 / 立即发送。 */
export declare const FOLLOWUP_QUEUE_ITEM_ID_KEY = "queueItemId";
export interface FollowupQueueTeammateView {
    from: string;
    summary?: string;
    content: string;
}
export interface FollowupQueueItemView {
    id: string;
    preview: string;
    /** XML 成员消息的结构化展示数据；正文有独立长度上限，不受 preview 截断影响。 */
    teammate?: FollowupQueueTeammateView;
    /** true = Tab 入队，等本回合结束；false = Enter/steer，下一次模型请求注入 */
    hold: boolean;
    createdAt: number;
}
export interface FollowupQueueSnapshot {
    sessionId: string;
    items: FollowupQueueItemView[];
}
/** ACP `session/steer` 回调。服务不直接碰 ACP，方便单测。 */
export type FollowupSteerFn = (contentBlocks: unknown[], modsPromptSubmitted?: true) => Promise<{
    steered: boolean;
}>;
export interface FollowupQueueService {
    snapshot(session: Session): FollowupQueueSnapshot;
    /** modsPromptSubmitted is host-validated provenance, never a client flag. */
    enqueue(session: Session, contentBlocks: unknown[], hold: boolean, modsPromptSubmitted?: true): FollowupQueueSnapshot;
    remove(session: Session, itemId: string): FollowupQueueSnapshot;
    /**
     * 立即发送：能插入当前回合就 `steer` 并从队列拿掉；否则只摘 queueHold。
     */
    sendNow(session: Session, itemId: string, steer?: FollowupSteerFn): Promise<FollowupQueueSnapshot>;
    watch(session: Session): void;
    unwatch(sessionId: string): void;
}
export declare function isFollowupDisplayItem(item: AgentInputItem): boolean;
//# sourceMappingURL=followup-queue-protocol.d.ts.map