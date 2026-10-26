import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { ChannelEvent, ChannelEventService, ChannelManager } from './channel-protocol';
export declare class ChannelEventServiceImpl implements ChannelEventService {
    protected readonly logger: Logger;
    protected readonly channelManager: ChannelManager;
    protected readonly sessionManager: SessionManager;
    initialize(): void;
    /**
     * 将 channel 事件添加到当前 session 的事件队列
     * 事件将在 ChannelEventAgentRunInterceptor 中被消费并注入到 agent input 中
     */
    pushEventToSession(event: ChannelEvent): void;
    /**
     * 消费指定 session 的所有待处理 channel 事件
     */
    consumeEventsForSession(sessionId: string): ChannelEvent[];
}
