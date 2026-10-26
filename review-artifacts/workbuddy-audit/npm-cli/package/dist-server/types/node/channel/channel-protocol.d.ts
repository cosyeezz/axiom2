import { Subject } from 'rxjs';
import { z } from 'zod';
export declare const ChannelManager: unique symbol;
export declare const ChannelEventService: unique symbol;
export declare const ChannelPermissionAdapter: unique symbol;
export declare const ChannelSecurityManager: unique symbol;
export declare const CHANNEL_NOTIFICATION_METHOD = "notifications/claude/channel";
export declare const CHANNEL_PERMISSION_REQUEST_METHOD = "notifications/claude/channel/permission_request";
export declare const CHANNEL_PERMISSION_RESPONSE_METHOD = "notifications/claude/channel/permission";
export declare const CHANNEL_CAPABILITY_KEY = "claude/channel";
export declare const CHANNEL_PERMISSION_CAPABILITY_KEY = "claude/channel/permission";
export declare const ChannelNotificationSchema: z.ZodObject<{
    method: z.ZodLiteral<"notifications/claude/channel">;
    params: z.ZodObject<{
        content: z.ZodString;
        meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, "strip", z.ZodTypeAny, {
        content: string;
        meta?: Record<string, string> | undefined;
    }, {
        content: string;
        meta?: Record<string, string> | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    method: "notifications/claude/channel";
    params: {
        content: string;
        meta?: Record<string, string> | undefined;
    };
}, {
    method: "notifications/claude/channel";
    params: {
        content: string;
        meta?: Record<string, string> | undefined;
    };
}>;
export declare const ChannelPermissionRequestSchema: z.ZodObject<{
    method: z.ZodLiteral<"notifications/claude/channel/permission_request">;
    params: z.ZodObject<{
        request_id: z.ZodString;
        tool_name: z.ZodString;
        description: z.ZodString;
        input_preview: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        description: string;
        request_id: string;
        tool_name: string;
        input_preview: string;
    }, {
        description: string;
        request_id: string;
        tool_name: string;
        input_preview: string;
    }>;
}, "strip", z.ZodTypeAny, {
    method: "notifications/claude/channel/permission_request";
    params: {
        description: string;
        request_id: string;
        tool_name: string;
        input_preview: string;
    };
}, {
    method: "notifications/claude/channel/permission_request";
    params: {
        description: string;
        request_id: string;
        tool_name: string;
        input_preview: string;
    };
}>;
export declare const ChannelPermissionResponseSchema: z.ZodObject<{
    method: z.ZodLiteral<"notifications/claude/channel/permission">;
    params: z.ZodObject<{
        request_id: z.ZodString;
        behavior: z.ZodEnum<["allow", "allow_always", "deny", "deny_and_exit_plan"]>;
    }, "strip", z.ZodTypeAny, {
        request_id: string;
        behavior: "allow" | "deny" | "allow_always" | "deny_and_exit_plan";
    }, {
        request_id: string;
        behavior: "allow" | "deny" | "allow_always" | "deny_and_exit_plan";
    }>;
}, "strip", z.ZodTypeAny, {
    method: "notifications/claude/channel/permission";
    params: {
        request_id: string;
        behavior: "allow" | "deny" | "allow_always" | "deny_and_exit_plan";
    };
}, {
    method: "notifications/claude/channel/permission";
    params: {
        request_id: string;
        behavior: "allow" | "deny" | "allow_always" | "deny_and_exit_plan";
    };
}>;
export type ChannelNotification = z.infer<typeof ChannelNotificationSchema>;
export type ChannelPermissionRequestNotification = z.infer<typeof ChannelPermissionRequestSchema>;
export type ChannelPermissionResponseNotification = z.infer<typeof ChannelPermissionResponseSchema>;
export interface ChannelEvent {
    serverName: string;
    content: string;
    meta?: Record<string, string>;
    timestamp: number;
}
export interface ChannelPermissionRequest {
    requestId: string;
    toolName: string;
    description: string;
    inputPreview: string;
}
export interface ChannelPermissionResponse {
    requestId: string;
    behavior: 'allow' | 'allow_always' | 'deny' | 'deny_and_exit_plan';
}
export interface ChannelServerInfo {
    serverName: string;
    hasPermissionRelay: boolean;
    mcpSession: any;
    instructions?: string;
}
export interface ChannelManager {
    readonly channelServers: Map<string, ChannelServerInfo>;
    readonly eventSubject: Subject<ChannelEvent>;
    /** Emits whenever a channel is registered or unregistered */
    readonly channelServersSubject: Subject<Map<string, ChannelServerInfo>>;
    /** Channels specified via --channels CLI flag (available before MCP connects) */
    readonly allowedChannels: Set<string> | undefined;
    /** Whether channels feature is enabled (can be disabled via settings) */
    readonly enabled: boolean;
    registerChannel(serverName: string, mcpSession: any, capabilities: any, instructions?: string): void;
    unregisterChannel(serverName: string): void;
    isChannel(serverName: string): boolean;
    getPermissionRelayChannels(): ChannelServerInfo[];
    broadcastPermissionRequest(request: ChannelPermissionRequest): void;
    /**
     * 为指定 session 添加 channel 事件到队列（在 ChannelEventService 中调用）
     */
    enqueueEventForSession(sessionId: string, event: ChannelEvent): void;
    /**
     * 消费并清空指定 session 的所有待处理事件（在 ChannelEventAgentRunInterceptor 中调用）
     */
    consumeEventsForSession(sessionId: string): ChannelEvent[];
    /**
     * Configure channel filtering from session options (--channels CLI flag)
     * When set, only listed channels are allowed to register.
     */
    configureFromSessionOptions(options: {
        channels?: string;
        dangerouslyLoadDevelopmentChannels?: string;
    }): void;
    /**
     * Check if a channel should bypass allowlist checks (--dangerously-load-development-channels)
     */
    shouldBypassAllowlist(serverName: string): boolean;
}
export interface ChannelEventService {
    pushEventToSession(event: ChannelEvent): void;
    /**
     * 获取并清空指定 session 的待处理 channel 事件
     * 用于在 agent 拦截器中注入事件
     */
    consumeEventsForSession(sessionId: string): ChannelEvent[];
}
export interface ChannelPermissionAdapter {
    createPermissionRequest(toolCallId: string, toolName: string, description: string, inputPreview: string): Promise<'allow' | 'allow_always' | 'deny' | 'deny_and_exit_plan'>;
    handlePermissionResponse(response: ChannelPermissionResponse): void;
    cancelRequest(toolCallId: string): void;
    /**
     * Query whether a request is still pending in adapter state.
     * Bridge layers use this to prune stale local request mirrors.
     */
    isPendingRequest?(requestId: string): boolean;
}
export interface ChannelSecurityManager {
    /**
     * Initialize allowlist for a channel, loading from disk if exists
     */
    initializeAllowlist(channelName: string): Promise<Set<string>>;
    /**
     * Check if a sender is in the channel's allowlist
     */
    isAllowedSender(channelName: string, senderId: string): Promise<boolean>;
    /**
     * Add a sender to the channel's allowlist and persist to disk
     */
    addSender(channelName: string, senderId: string): Promise<void>;
    /**
     * Remove a sender from the channel's allowlist
     */
    removeSender(channelName: string, senderId: string): Promise<void>;
}
