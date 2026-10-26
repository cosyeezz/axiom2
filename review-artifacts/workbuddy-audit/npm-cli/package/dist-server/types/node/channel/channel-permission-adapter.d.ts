import { Logger } from '@genie/telemetry';
import { ChannelManager, ChannelPermissionAdapter, ChannelPermissionResponse } from './channel-protocol';
export declare class ChannelPermissionAdapterImpl implements ChannelPermissionAdapter {
    protected readonly logger: Logger;
    protected readonly channelManager: ChannelManager;
    private pendingRequests;
    private toolCallToRequestId;
    /**
     * 生成符合规范的 request_id
     * 5 个小写字母，排除 'l'
     */
    private generateRequestId;
    /**
     * 创建权限请求并广播到 channels
     * 返回 Promise，与本地 UI 审批竞速
     */
    createPermissionRequest(toolCallId: string, toolName: string, description: string, inputPreview: string): Promise<'allow' | 'allow_always' | 'deny' | 'deny_and_exit_plan'>;
    /**
     * 处理来自 channel 的权限响应
     */
    handlePermissionResponse(response: ChannelPermissionResponse): void;
    /**
     * 当本地 UI 已经做出决定时，取消待处理的 channel 请求
     */
    cancelRequest(toolCallId: string): void;
    isPendingRequest(requestId: string): boolean;
}
