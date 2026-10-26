/**
 * Remote Control Module Protocol
 *
 * 定义远程控制模块的所有类型、接口和 DI Symbols
 * 参考 genie-ide/src/vs/platform/wecom/common/wecom.ts
 */
import { Subject } from 'rxjs';
export declare const RemoteControlService: unique symbol;
export declare const RemoteControlApiClient: unique symbol;
export declare const RemoteControlCentrifugoClient: unique symbol;
export declare const RemoteControlMessageHandler: unique symbol;
export declare const LongConnectionClientRegistry: unique symbol;
export declare const ENV_KEY_REMOTE_CONTROL_API_KEY = "CODEBUDDY_REMOTE_CONTROL_API_KEY";
export declare const ENV_KEY_REMOTE_CONTROL_BASE_URL = "CODEBUDDY_REMOTE_CONTROL_BASE_URL";
/** Set to '1' or 'true' to auto-connect ALL channel types (wecom + wechat) on startup */
export declare const ENV_KEY_CHANNEL_AUTO_CONNECT = "CODEBUDDY_CHANNEL_AUTO_CONNECT";
/** Set to '1' or 'true' to auto-connect WeCom instances on startup */
export declare const ENV_KEY_WECOM_AUTO_CONNECT = "CODEBUDDY_WECOM_AUTO_CONNECT";
/** Set to '1' or 'true' to auto-connect WeChat instances on startup */
export declare const ENV_KEY_WECHAT_AUTO_CONNECT = "CODEBUDDY_WECHAT_AUTO_CONNECT";
export interface RemoteControlConfig {
    /** 是否启用远程控制 */
    enabled: boolean;
    /** daemon 根据用户意图及全局开关恢复 Centrifugo；普通 CLI 不自动连接。 */
    autoConnect?: boolean;
    /** AgentOS 服务基础 URL */
    baseUrl: string;
    /** API Key（可选，不提供则使用 Bearer token） */
    apiKey?: string;
    /** LocalAgent 类型标识：cli, ide, workbuddy */
    localAgentType: string;
    /** 主机唯一标识 */
    hostId: string;
    /** 是否使用摘要模式 */
    useSummary: boolean;
    /** 是否复用 UI 当前 session（默认 true） */
    reuseUISession?: boolean;
}
export type RemoteControlConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface RemoteControlConnectionState {
    status: RemoteControlConnectionStatus;
    serverUrl?: string;
    connectedAt?: number;
    error?: string;
}
export interface RegisterWorkspaceRequest {
    /** 用户 ID(可选,使用 Bearer token 时由服务端解析) */
    userId?: string;
    /** LocalAgent 类型:cli, ide, workbuddy */
    localAgentType: string;
    /** 主机 ID */
    hostId: string;
    /** 工作区 ID */
    workspaceId: string;
    /** 工作区名称(可选,用于增加可读性) */
    workspaceName?: string;
    /** IM 账号标识，如企微客服号 accountId（可选，用于多客服号场景下过滤 workspace 列表） */
    accountId?: string;
}
export interface RegisterWorkspaceResponse {
    /** Centrifugo WebSocket URL */
    url: string;
    /** 连接令牌 */
    connectionToken: string;
    /** 订阅令牌 */
    subscriptionToken: string;
    /** 订阅频道 */
    channel: string;
}
export interface WorkspaceSubscription {
    workspaceId: string;
    workspaceName: string;
    channel: string;
    subscriptionToken: string;
}
export interface RemoteControlTaskMessage {
    /** 请求唯一标识 */
    requestId: string;
    /** 任务提示词 */
    prompt: string | Array<{
        type: string;
        text?: string;
    }>;
    /** 附加元数据 */
    metadata?: Record<string, unknown>;
}
export interface RemoteControlResponse {
    /** 响应类型 */
    type: 'COPILOT_RESPONSE';
    /** 消息 ID（对应 requestId） */
    msgId: string;
    /** 会话 ID */
    chatId: string;
    /** 是否成功 */
    success: boolean;
    /** 响应消息 */
    message: string;
    /** 元数据 */
    metadata?: {
        sessionId?: string;
        state?: 'completed' | 'error';
        error?: string;
        fullOutputLength?: number;
        /** 标记 session 是否被复用 */
        uiSessionReused?: boolean;
    };
}
/** Options for {@link IRemoteControlService.startClient}. */
export interface StartClientOptions {
    /**
     * Whether this start is an explicit user action. Defaults to `true`: a user
     * pressing "connect" (Web UI / TUI panel / `/remote-control`) is allowed to
     * take over a bot that another live process serves.
     *
     * Automatic callers (daemon startup auto-connect, restart restore) must pass
     * `force: false` so they yield to the live holder instead of kicking it off
     * the bot's single WebSocket subscription.
     */
    force?: boolean;
    /** 自动恢复不修改用户意图；与是否接管其他进程的 force 语义分离。 */
    automatic?: boolean;
}
export interface IRemoteControlService {
    /** 状态变更事件 */
    readonly onStatusChange: Subject<RemoteControlConnectionStatus>;
    /** 消息接收事件 */
    readonly onMessage: Subject<{
        channel: string;
        data: RemoteControlTaskMessage;
    }>;
    /** 启动服务（启动所有 shouldAutoConnect 的客户端） */
    start(): Promise<void>;
    /** 停止服务（停止所有客户端） */
    stop(): Promise<void>;
    /** 获取当前状态 */
    getStatus(): RemoteControlConnectionStatus;
    /** 按类型启动单个长连接客户端 */
    startClient(clientType: string, options?: StartClientOptions): Promise<void>;
    /** 按类型停止单个长连接客户端 */
    stopClient(clientType: string): Promise<void>;
    /** 发送响应 */
    sendResponse(response: RemoteControlResponse): Promise<void>;
    /** 释放资源 */
    dispose(): void;
}
export interface IRemoteControlApiClient {
    /** 设置配置 */
    setConfig(config: RemoteControlConfig): void;
    /** 注册工作区 */
    registerWorkspace(request: RegisterWorkspaceRequest): Promise<RegisterWorkspaceResponse>;
    /** 发送响应 */
    sendResponse(response: RemoteControlResponse): Promise<void>;
}
export interface IRemoteControlCentrifugoClient {
    /** 当前状态 */
    readonly status: RemoteControlConnectionStatus;
    /** 消息事件 */
    readonly onMessage: Subject<{
        channel: string;
        data: RemoteControlTaskMessage;
    }>;
    /** 状态变更事件 */
    readonly onStatusChange: Subject<RemoteControlConnectionState>;
    /** 连接到服务器 */
    connect(url: string, connectionToken: string, getToken?: () => Promise<string>): Promise<void>;
    /** 订阅频道 */
    subscribeChannel(subscription: WorkspaceSubscription, getSubToken?: () => Promise<string>): Promise<void>;
    /** 取消订阅频道 */
    unsubscribeChannel(channel: string): void;
    /** 断开连接 */
    disconnect(): void;
    /** 销毁 */
    dispose(): void;
}
export interface IRemoteControlMessageHandler {
    /** 处理消息（Centrifugo 原有流程，保留兼容） */
    handleMessage(message: RemoteControlTaskMessage, workspaceId: string, config: RemoteControlConfig, hostId: string): Promise<RemoteControlResponse>;
    /**
     * 快速检测并执行本地命令（不涉及 session 复用，用于 Service 层快速判断）。
     * 如果是本地命令，直接执行并返回结果；
     * 如果不是本地命令，返回 undefined（继续走 agent 管道）。
     */
    tryExecuteLocalCommandQuickly(promptText: string): Promise<string | undefined>;
    /**
     * 公共执行方法：接收消息文本 → 获取/创建 session → 执行 agent → 等待回复。
     * 供所有长连接客户端统一调用。
     */
    executeAndWaitForReply(promptText: string, conversationId: string, requestId: string): Promise<string>;
    /** 取消任务 */
    cancelTask(requestId: string): boolean;
}
/** QR code authentication status (for clients that use QR scan-to-login) */
export interface QRAuthStatus {
    type: 'fetching' | 'qr_ready' | 'scanned' | 'expired' | 'confirmed' | 'error';
    message: string;
    /** UTF-8 rendered QR code text for terminal display */
    qrText?: string;
    /** Original QR code URL (fallback for manual open) */
    qrUrl?: string;
}
/**
 * Long connection client interface.
 * Different message channels (Centrifugo, wecom, etc.) implement this interface.
 */
export interface ILongConnectionClient {
    /** Client type identifier (e.g. 'centrifugo', 'wecom') */
    readonly clientType: string;
    /** Instance identifier for multi-instance support (e.g. 'default', 'mybot') */
    readonly instanceId: string;
    /** Display name for UI (e.g. 'wecom:bot1'). Defaults to clientType:instanceId */
    readonly displayName?: string;
    /** Current connection status */
    readonly status: RemoteControlConnectionStatus;
    /** Message event (emitted when a user message is received, in unified LongConnectionMessage format) */
    readonly onMessage: Subject<LongConnectionMessage>;
    /** Status change event */
    readonly onStatusChange: Subject<RemoteControlConnectionState>;
    /** Whether this client should auto-connect when Service.start() is called */
    readonly shouldAutoConnect: boolean;
    /**
     * Whether this client's connection depends on the CBC login session.
     * Auth-scoped clients (e.g. Centrifugo) must be torn down on logout and
     * re-established on login. Independent channel clients (WeCom / WeChat
     * AI Bot long connections) authenticate with their own credentials and
     * must survive auth transitions. Defaults to true for backwards compat.
     */
    readonly requiresAuth?: boolean;
    /**
     * Persist the user's intent to keep this channel connected across process
     * restarts and auth transitions. Only meaningful for `requiresAuth === false`
     * clients (WeCom / WeChat bots). No-op for clients that do not support it.
     */
    setAutoConnect?(enabled: boolean): void;
    /** Whether this client should be hidden from the /remote-control UI panel */
    readonly hidden?: boolean;
    /**
     * WeCom: whether assistant text is streamed into the IM bubble.
     * Omitted / true → stream; false → WeComReply-only (2.140.0).
     */
    readonly streaming?: boolean;
    /** Persist the WeCom streaming preference for this instance. Returns false if persist failed. */
    setStreaming?(enabled: boolean): boolean | void;
    /**
     * WeCom: whether Ask / permission / suggestion use template cards.
     * Omitted / true → cards; false → text replies (2.140.0).
     */
    readonly cards?: boolean;
    /** Persist the WeCom card-interaction preference. Returns false if persist failed. */
    setCards?(enabled: boolean): boolean | void;
    /**
     * WeCom: whether channel (频道) posts / replies are consumed as agent input.
     * Omitted / false → off (default, opt-in).
     */
    readonly topicEvents?: boolean;
    /** Persist the WeCom channel-events preference. Returns false if persist failed. */
    setTopicEvents?(enabled: boolean): boolean | void;
    /**
     * When true, messages are handled via the channel system (WechatChannelBridge etc.)
     * and RemoteControlService skips its executeAndWaitForReply pipeline for this client.
     */
    readonly usesChannelBridge?: boolean;
    /** QR auth state change event (for clients that use QR scan-to-login) */
    readonly onQRAuthStateChange?: Subject<QRAuthStatus>;
    /**
     * Start connection.
     *
     * @param options.force - Explicit user action: take over even when another
     *   live process currently holds the underlying transport. Automatic
     *   (startup / restore) connects omit this and must not steal a live owner.
     */
    connect(config: RemoteControlConfig, options?: {
        force?: boolean;
    }): Promise<void>;
    /** Disconnect */
    disconnect(): void;
    /** Dispose resources */
    dispose(): void;
    /**
     * Send reply to message source.
     * Each long connection type has a different reply mechanism:
     *   - Centrifugo: delegates to RemoteControlApiClient HTTP callback
     *   - wecom: sends aibot_respond_msg via WebSocket
     */
    sendReply(context: LongConnectionReplyContext, content: string): Promise<void>;
    /**
     * Send streaming response chunk (optional).
     * Long connections that support streaming (e.g. wecom stream message type) can implement this.
     */
    sendStreamChunk?(context: LongConnectionReplyContext, chunk: string, streamId: string, finished: boolean): Promise<void>;
    /**
     * Send proactive/async reply (optional).
     * Unlike sendReply (which uses the callback req_id and is subject to stream timeout),
     * this uses a proactive push mechanism (e.g. wecom aibot_send_msg) that is not
     * bound by stream timeout. Suitable for long-running Agent tasks.
     */
    sendAsyncReply?(context: LongConnectionReplyContext, content: string): Promise<void>;
}
/** Unified message format (from all long connections → Service) */
export interface LongConnectionMessage {
    /** Unique message ID */
    requestId: string;
    /** User message text */
    prompt: string;
    /** Reply context metadata (passed back to client when replying) */
    replyContext: LongConnectionReplyContext;
    /** Whether this is an event (not a user message) */
    isEvent?: boolean;
    /** Event type (if isEvent is true) */
    eventType?: string;
}
/** Reply context (travels with message, returned to client for reply routing) */
export interface LongConnectionReplyContext {
    /** Client type */
    clientType: string;
    /** User/session identifier (for building chatId) */
    userId: string;
    /** Conversation ID */
    conversationId: string;
    /** Platform-specific data (e.g. wecom's req_id, chatid, chattype) */
    platformData?: Record<string, unknown>;
}
/** Long connection client registry interface */
export interface ILongConnectionClientRegistry {
    /** Register a client (key = clientType:instanceId) */
    register(client: ILongConnectionClient): void;
    /** Unregister a client */
    unregister(clientType: string, instanceId: string): void;
    /** Get all registered clients */
    getAll(): ILongConnectionClient[];
    /** Get all clients of a given type */
    getByType(clientType: string): ILongConnectionClient[];
    /** Get a specific client by type and instanceId */
    get(clientType: string, instanceId?: string): ILongConnectionClient | undefined;
}
