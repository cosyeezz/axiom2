import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import { MessageQueueManager, type Session } from '../session/session-protocol';
import { type FollowupQueueItemView, type FollowupQueueService, type FollowupQueueSnapshot, type FollowupSteerFn } from './followup-queue-protocol';
import { type QueueBroadcastHost as AcpBroadcastService } from './queue-host-protocol';
export declare function isFollowupQueueAvailable(session: Session): boolean;
export declare function contentBlocksToFollowupItem(contentBlocks: unknown[], hold: boolean): AgentInputItem;
export declare function ensureFollowupItemId(item: AgentInputItem): string;
export declare function previewFollowupItem(item: AgentInputItem): string;
export declare function previewFollowupTeammate(item: AgentInputItem): FollowupQueueItemView['teammate'];
export declare function snapshotFollowupQueue(session: Session): FollowupQueueSnapshot;
export declare function findFollowupIndex(session: Session, itemId: string): number;
/** 把队列项还原成 ACP contentBlocks，供 `session/steer` 立即插入。 */
export declare function followupItemToContentBlocks(item: AgentInputItem): unknown[];
export declare class FollowupQueueServiceImpl implements FollowupQueueService {
    protected readonly messageQueueManager: MessageQueueManager;
    protected readonly acpBroadcastService?: AcpBroadcastService;
    private readonly watches;
    /**
     * Queue draining can synchronously emit several queueSubject snapshots
     * (clear, then re-enqueue the items that remain). Coalesce those emissions
     * so the Web UI never observes a transient empty queue and promotes a
     * still-pending item into the transcript.
     */
    private readonly pendingBroadcasts;
    snapshot(session: Session): FollowupQueueSnapshot;
    enqueue(session: Session, contentBlocks: unknown[], hold: boolean, modsPromptSubmitted?: true): FollowupQueueSnapshot;
    remove(session: Session, itemId: string): FollowupQueueSnapshot;
    sendNow(session: Session, itemId: string, steer?: FollowupSteerFn): Promise<FollowupQueueSnapshot>;
    watch(session: Session): void;
    unwatch(sessionId: string): void;
    private releaseHold;
    private scheduleBroadcast;
    private broadcast;
}
export { FollowupQueueService, FOLLOWUP_QUEUE_META_KEY } from './followup-queue-protocol';
//# sourceMappingURL=followup-queue.d.ts.map