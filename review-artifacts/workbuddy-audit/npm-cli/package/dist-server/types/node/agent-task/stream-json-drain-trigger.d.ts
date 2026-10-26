import { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { DrainWaitOutcome, StreamJsonDrainTrigger } from './agent-task-protocol';
/**
 * stdio stream-json 长轮询 drain 触发器的实现（方向 B1）。
 *
 * 维护 per-session 的 parked waiter（一条 `Deferred<DrainWaitOutcome>` + 超时定时器）。
 * - 长轮询 handler 调 `registerWaiter` 挂起；
 * - 后台任务完成时 `BackgroundTaskNotifierImpl` 调 `signal` 唤醒；
 * - 超时或被 signal 后清理该 session 的 waiter，允许下一条长轮询重新注册。
 *
 * 语义参考 `AcpDrainTrigger`，但机制不同：ACP 往 promptEvent 推 item，这里是
 * "唤醒一条挂起的 HTTP 长轮询"，让 drain-run 在那条请求的响应上下文里渲染。
 */
export declare class StreamJsonDrainTriggerImpl implements StreamJsonDrainTrigger {
    protected readonly logger: Logger;
    init(): void;
    /** sessionId → parked waiter。每 session 最多一条。 */
    private readonly waiters;
    registerWaiter(session: Session, timeoutMs: number): Promise<DrainWaitOutcome>;
    signal(session: Session): boolean;
    hasWaiter(session: Session): boolean;
}
