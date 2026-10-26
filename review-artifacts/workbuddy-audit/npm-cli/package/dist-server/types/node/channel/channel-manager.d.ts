import { Logger } from '@genie/telemetry';
import { Subject } from 'rxjs';
import { SettingsManager } from '../settings';
import { ChannelEvent, ChannelManager, ChannelPermissionRequest, ChannelServerInfo } from './channel-protocol';
export declare class ChannelManagerImpl implements ChannelManager {
    protected readonly logger: Logger;
    protected readonly settingsManager?: SettingsManager;
    private _enabled;
    get enabled(): boolean;
    readonly channelServers: Map<string, ChannelServerInfo>;
    readonly eventSubject: Subject<ChannelEvent>;
    readonly channelServersSubject: Subject<Map<string, ChannelServerInfo>>;
    private sessionEventQueues;
    allowedChannels: Set<string> | undefined;
    private developmentChannels;
    /**
     * 注册 channel 服务器
     * 在 MCP 连接成功后调用，检测 experimental capabilities
     */
    registerChannel(serverName: string, mcpSession: any, capabilities: any, instructions?: string): void;
    unregisterChannel(serverName: string): void;
    isChannel(serverName: string): boolean;
    getPermissionRelayChannels(): ChannelServerInfo[];
    /**
     * 广播权限请求到所有支持 permission relay 的 channels
     */
    broadcastPermissionRequest(request: ChannelPermissionRequest): void;
    /**
     * 为 session 添加 channel 事件到队列
     */
    enqueueEventForSession(sessionId: string, event: ChannelEvent): void;
    /**
     * 消费并清空指定 session 的所有待处理事件
     */
    consumeEventsForSession(sessionId: string): ChannelEvent[];
    configureFromSessionOptions(options: {
        channels?: string;
        dangerouslyLoadDevelopmentChannels?: string;
    }): void;
    shouldBypassAllowlist(serverName: string): boolean;
}
