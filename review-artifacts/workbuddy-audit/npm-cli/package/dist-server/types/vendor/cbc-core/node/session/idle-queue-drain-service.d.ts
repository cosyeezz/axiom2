/**
 * Wake local queues after a turn ends. Mode A owns session.queue; Mode B tasks
 * own its non-mirror items. Mode B main sessions remain with rich queue.
 * MessageQueueAgentRunInterceptor remains the only dequeue/merge point.
 */
import { Logger } from '@genie/telemetry';
import { AgentManager, AgentService } from '../agent/agent-protocol';
import { type IdleQueueDrainService, MessageQueueManager, Session } from './session-protocol';
export declare class IdleQueueDrainServiceImpl implements IdleQueueDrainService {
    protected readonly logger: Logger;
    protected readonly agentService?: AgentService;
    protected readonly agentManager?: AgentManager;
    protected readonly messageQueueManager?: MessageQueueManager;
    /** 每个 session 一条订阅，按 sessionId 索引。 */
    private readonly subscriptions;
    /** 正在 tryDrain 中的 sessionId，重入 guard 用。 */
    private readonly dispatching;
    register(session: Session): void;
    unregister(sessionId: string): void;
    /** 延后一个 microtask，让 `agent_end` 的同步订阅者先跑完，避免抢状态。 */
    private scheduleDrain;
    /**
     * 显式请求一次 drain，走与 `agent_end` 订阅完全相同的 guard 链与回填逻辑。
     *
     * 由 `InterruptionService` 在取消记账落盘后调用：顺序保证从「等 2 秒」变成
     * 「记账完成 → 才 drain」的因果关系。幂等——重入 guard 让并发调用变 no-op，
     * 空队列直接返回。
     */
    requestDrain(session: Session): void;
    /** Reuse the existing idle drain and its pre-result failure restoration. */
    private tryDrain;
}
//# sourceMappingURL=idle-queue-drain-service.d.ts.map