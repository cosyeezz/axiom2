/**
 * WeChat Work AI Bot Long Connection Client
 *
 * Implements ILongConnectionClient for enterprise WeChat AI Bot WebSocket connections.
 * Uses the aibot WebSocket API (wss://openws.work.weixin.qq.com) with bot_id + secret auth.
 *
 * Credential resolution order:
 * 1. Environment variables (CODEBUDDY_WECOM_BOT_ID, CODEBUDDY_WECOM_BOT_SECRET)
 * 2. Saved credentials on disk (~/.codebuddy/channels/wecom/instances.json)
 * 3. WeCom official QR bind (same pairing page as @wecom/wecom-openclaw-cli), then hand-fill fallback
 *
 * Messages are handled via WecomBotChannelBridge (usesChannelBridge = true),
 * which injects them into the channel system as <channel source="wecom"> events.
 * Replies are sent via sendAsyncReply (aibot_send_msg proactive push).
 *
 * Features:
 * - WebSocket connection with aibot_subscribe authentication
 * - 30s heartbeat (ping)
 * - Exponential backoff reconnection with jitter
 * - Message deduplication (LRU Set)
 * - Proactive message push (aibot_send_msg) for channel bridge replies
 * - Stream reply support (aibot_respond_msg) — retained for interface compatibility
 * - Event handling (enter_chat welcome, disconnected_event reconnect)
 * - Runtime detection: uses Bun global WebSocket or Node.js ws package
 *
 * Reference: https://developer.work.weixin.qq.com/document/path/101463
 */
import type { Logger } from '@genie/telemetry';
import { Subject } from 'rxjs';
import { type ILongConnectionClient, type LongConnectionMessage, type LongConnectionReplyContext, type QRAuthStatus, type RemoteControlConfig, type RemoteControlConnectionState, type RemoteControlConnectionStatus } from '../../remote-control-protocol';
import { type WecomBotCredentials } from './wecom-bot-auth';
import { type WecomCardClick, type WecomTemplateCard } from './wecom-bot-interaction';
import { WecomTopicApi, type WecomTopicEvent } from './wecom-bot-topic';
export declare class WecomBotClient implements ILongConnectionClient {
    readonly clientType = "wecom";
    instanceId: string;
    displayName?: string;
    /**
     * Auto-connect when the service starts / after a re-login, driven by the
     * persisted per-instance `autoConnect` flag. Set once the user connects the
     * bot, cleared when the user explicitly stops it.
     */
    get shouldAutoConnect(): boolean;
    readonly usesChannelBridge = true;
    /** WeCom AI Bot long connections authenticate with bot credentials, not the CBC login. */
    readonly requiresAuth = false;
    /** 扫码中的临时实例不进 /remote-control 列表，避免前端重挂载刷出一堆 connecting。 */
    get hidden(): boolean;
    readonly onMessage: Subject<LongConnectionMessage>;
    readonly onCardEvent: Subject<WecomCardClick>;
    /** Channel (频道) posts / replies announced by WeCom. Only emitted when {@link topicEvents} is on. */
    readonly onTopicEvent: Subject<WecomTopicEvent>;
    readonly onStatusChange: Subject<RemoteControlConnectionState>;
    readonly onQRAuthStateChange: Subject<QRAuthStatus>;
    private logger;
    private ws;
    private heartbeatTimer;
    private reconnectTimer;
    private reconnectAttempts;
    private _status;
    private shouldReconnect;
    /**
     * 最近一次收到 ws 帧（消息或 pong）的时间戳。watchdog 用它判定连接是否还活着。
     * 必须在每条消息到达时刷新。
     */
    private lastWsActivityAt;
    /**
     * Liveness watchdog：监测心跳活动是否陈旧。
     *
     * 背景：macOS 屏幕锁屏 / App Nap 会冻结网络栈和定时器。
     * - heartbeatTimer 被冻结 → 不再发 ping
     * - 即便底层 TCP 已断（路由器空闲超时等），ws 对象的 onclose 也可能延迟很久才触发
     * - 解锁后我们看到的是"还连着"，但其实远端早把 session 抛了
     *
     * watchdog 在解冻瞬间触发，关掉僵尸 ws → onclose → scheduleReconnect 走原有重连路径。
     */
    private watchdog;
    private readonly processedMsgIds;
    private readonly msgIdQueue;
    private readonly pendingResponses;
    private readonly respondQueue;
    private credentials;
    private autoConnectEnabled;
    private lock;
    private credentialPromptAbort;
    /** Polls for the local process that kicked us off the bot to go away. */
    private takeoverWatch;
    private streamingEnabled;
    private cardsEnabled;
    private topicEventsEnabled;
    private topicApi;
    private topicApiKey;
    get status(): RemoteControlConnectionStatus;
    get streaming(): boolean;
    setStreaming(enabled: boolean): boolean;
    get cards(): boolean;
    setCards(enabled: boolean): boolean;
    get topicEvents(): boolean;
    setTopicEvents(enabled: boolean): boolean;
    /** HTTPS client for channel content; token is cached per credentials. */
    getTopicApi(): WecomTopicApi;
    /** Initialize the client. Called by the factory after construction. */
    init(logger: Logger, instanceId: string, displayName?: string, credentials?: WecomBotCredentials | null, options?: {
        streaming?: boolean;
        cards?: boolean;
        topicEvents?: boolean;
    }): void;
    /**
     * 全局默认(global.json/env)更新后同步到内存。
     * 仅当该实例**未显式**设置 streaming/cards（instances.json 无该字段）时才覆盖，
     * 显式配置过的机器人保持原样，避免 UI 切换全局默认误改单机器人设置。
     */
    applyWecomGlobalDefaultIfUnset(): void;
    /**
     * Configure this client for a specific instance (called by factory before connect).
     * @deprecated Use init() instead.
     */
    configureInstance(instanceId: string, displayName?: string, credentials?: WecomBotCredentials): void;
    /** Check if credentials are available and valid */
    isConfigured(): boolean;
    getCredentials(): WecomBotCredentials | null;
    /** Persist the user's intent to keep this bot connected. */
    setAutoConnect(enabled: boolean): void;
    /** Move a QR pending client onto a stable instance id after bind. */
    rekeyInstance(instanceId: string, displayName?: string): void;
    /** Lazily create the cross-process lock bound to the current instanceId. */
    private connectionLock;
    connect(_config?: RemoteControlConfig, options?: {
        force?: boolean;
    }): Promise<void>;
    /**
     * Show the official WeCom pairing QR (or hand-fill instructions if generate fails).
     */
    private promptForCredentials;
    disconnect(): void;
    /** Clear in-memory credentials so next connect() triggers re-auth (interactive prompt). */
    clearCredentials(): void;
    dispose(): void;
    /**
     * The server kicked us off the bot because another subscriber used the same
     * bot_id + secret. Tear down locally (no reconnect loop: that would kick the
     * other side right back), then decide whether to come back later.
     *
     * If the taker is another live process on this machine, it holds the
     * connection lock, so we know it will eventually exit (a one-shot session, a
     * short-lived helper) and can safely reconnect once it is gone. If the taker
     * is anywhere else we cannot know when it leaves, so we stay down.
     */
    private handleKickedByAnotherInstance;
    private startTakeoverWatch;
    private stopTakeoverWatch;
    /**
     * Send reply via WebSocket as a single stream message with finish=true.
     * Retained for ILongConnectionClient interface compatibility.
     */
    sendReply(context: LongConnectionReplyContext, content: string): Promise<void>;
    /**
     * Send streaming response chunk via stream message type.
     * Same req_id is serialized through the respond queue.
     */
    sendStreamChunk(context: LongConnectionReplyContext, chunk: string, streamId: string, finished: boolean): Promise<void>;
    /** First frame: finish=false, content=`<think></think>`. */
    openStream(reqId: string, streamId: string): Promise<void>;
    /** Full-replace stream update. Empty finish is dropped so the thinking animation is not locked. */
    pushStream(reqId: string, streamId: string, content: string, finish: boolean): Promise<void>;
    /**
     * Send proactive message via aibot_send_msg (no stream timeout).
     * Used by WecomBotChannelBridge for channel bridge replies.
     * Only requires chatid, not the original req_id.
     */
    sendAsyncReply(context: LongConnectionReplyContext, content: string): Promise<void>;
    sendTemplateCard(context: LongConnectionReplyContext, card: WecomTemplateCard): Promise<void>;
    updateTemplateCard(reqId: string, card: WecomTemplateCard): Promise<void>;
    /**
     * Send a WebSocket frame and wait for the response with matching req_id.
     * Implements request-response pattern over the fire-and-forget WebSocket.
     */
    private sendFrameWithResponse;
    /**
     * Upload media file to WeCom via WebSocket chunked upload protocol.
     *
     * Protocol (3 steps):
     * 1. aibot_upload_media_init  → returns upload_id
     * 2. aibot_upload_media_chunk → sends base64-encoded chunks
     * 3. aibot_upload_media_finish → returns media_id
     *
     * @param fileBuffer - File content as Buffer
     * @param options - Upload options (type, filename)
     * @returns Upload result with media_id
     */
    uploadMedia(fileBuffer: Buffer, options: {
        type: 'image' | 'file' | 'video' | 'voice';
        filename: string;
    }): Promise<{
        media_id: string;
        type: string;
    }>;
    /**
     * Send a media message to a chat via aibot_send_msg.
     *
     * @param chatId - Target chat ID (user ID for single, group ID for group)
     * @param mediaType - Media type (image, file, video, voice)
     * @param mediaId - The media_id from uploadMedia
     * @param chatType - Chat type: 1=single, 2=group (default: inferred from chatId)
     */
    sendMediaMessage(chatId: string, mediaType: 'image' | 'file' | 'video' | 'voice', mediaId: string, chatType?: 1 | 2): Promise<void>;
    private doConnect;
    private sendSubscribe;
    private handleFrame;
    private handleMsgCallback;
    private handleEventCallback;
    /**
     * Let a channel event be re-delivered after its processing failed: the bridge
     * calls this when pulling content threw, otherwise the recorded msgid
     * would swallow any retry from the server.
     */
    releaseTopicEvent(ev: WecomTopicEvent): void;
    /**
     * Channel content notifications carry ids only; the bridge pulls the content.
     * Off by default (opt-in per bot): when off the event is only logged, as before.
     */
    private handleTopicEventCallback;
    private handleEnterChat;
    private startHeartbeat;
    private stopHeartbeat;
    /**
     * 启动 ws liveness watchdog。详见 ../liveness-watchdog.ts。
     *
     * 策略：超过 90s 没收到任何 ws 帧 → 强制 ws.close() → 触发 onclose →
     * shouldReconnect=true 时进入 scheduleReconnect 走原有重连路径。
     * 这样 macOS 锁屏解冻后能在 ~30s 内（一个 watchdog tick）恢复，
     * 而不是等 TCP keepalive 或远端清理 session。
     */
    private startWatchdog;
    private stopWatchdog;
    private scheduleReconnect;
    private clearReconnectTimer;
    private isDuplicate;
    private recordMsgId;
    /**
     * Extract text and download media files from a WeCom AI Bot message.
     * Media files (image/file/voice) are downloaded to a temp directory and referenced by path.
     * Pattern: same as wechat-client.ts extractContent()
     */
    private extractContent;
    private rejectAllPendingResponses;
    private sendFrame;
    private setStatus;
}
