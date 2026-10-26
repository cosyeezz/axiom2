/**
 * Remote Gateway Protocol
 *
 * 定义通用远程网关模块的所有类型、接口和 DI Symbols。
 * 支持两种网络模式：
 *   - 模式 A: 云端 Gateway 中转（AgentOS + Centrifugo WebSocket）
 *   - 模式 B: 本地 Gateway + Cloudflare Tunnel（HTTP + SSE）
 *
 * Web UI 直接复用 ACP 协议，不使用 Gateway Protocol。
 * Gateway Protocol 仅用于企业机器人等第三方平台的 Webhook 接入。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { Subject } from 'rxjs';
export declare const GatewayAcpBridge: unique symbol;
export declare const GatewayConfigService: unique symbol;
export declare const GatewayTunnelService: unique symbol;
export declare const GatewayLocalServer: unique symbol;
export declare const GatewayAuthMiddleware: unique symbol;
export declare const GatewayRateLimiter: unique symbol;
export declare const GatewayAdapterRegistry: unique symbol;
export declare const GatewayCorsService: unique symbol;
export declare const HostValidationMiddleware: unique symbol;
export declare const GatewayAuditLog: unique symbol;
export declare const CloudGatewayClient: unique symbol;
export declare const CloudGatewayApiClient: unique symbol;
/**
 * 自定义请求头名称。
 * 所有 API 请求必须携带此头（值为 '1'），用于：
 * 1. 强制浏览器对跨域请求发送 preflight (OPTIONS)
 * 2. 服务端校验，防止简单请求绕过 CORS 预检
 */
export declare const CUSTOM_REQUEST_HEADER = "x-codebuddy-request";
/**
 * E2B envd 兼容的凭据头（issue #78178）。
 *
 * 值为 Gateway 密码，语义与 `Authorization: Bearer <password>` 完全等价。
 * 存在的意义是让按 E2B `envd` 习惯集成的客户端能直接复用同一套调用代码
 * —— envd 用 `X-Access-Token` 承载 sandbox 的 access token
 * （见 e2b-dev/infra `packages/envd/internal/api/auth.go`）。
 */
export declare const ACCESS_TOKEN_HEADER = "x-access-token";
/**
 * 将安全请求头合并到 headers 对象中。
 * 统一入口，避免在每个 HTTP 调用点重复 `[CUSTOM_REQUEST_HEADER]: '1'`。
 *
 * @example
 * // Node.js http.request
 * http.request({ headers: withSecurityHeader({ 'Content-Type': 'application/json' }) })
 *
 * // CellJS RestOperations
 * restOperations.post(url, body, { headers: withSecurityHeader({ ... }) })
 *
 * // fetch
 * fetch(url, { headers: withSecurityHeader({ Authorization: `Bearer ${token}` }) })
 */
export declare function withSecurityHeader<T extends Record<string, string>>(headers?: T): T & Record<string, string>;
/**
 * CBC 进程内对本进程 loopback `/internal/*` 自调用时附带的 Bearer 凭据。
 *
 * `/internal/*` 自 issue #143153 起纳入网关认证（此前整组豁免被远程利用：
 * `--serve --host 0.0.0.0` 下 `POST /internal/config/set` 可未授权写 ConfigChange
 * Hook → RCE）。同进程自调用方（ACP `initializeSession`、CLI executor）持有 auth
 * 组件，用它的密码自证——与本机其它进程/远端不同，自调用方能拿到进程密码。
 *
 * auth 未启用（非 `--serve` / `--auth none`）时返回空对象，不改变既有行为。
 */
export declare function gatewayBearerHeader(auth: Pick<IGatewayAuthMiddleware, 'isEnabled' | 'getPassword'> | undefined): Record<string, string>;
export declare const GATEWAY_PROTOCOL_VERSION = "1.0";
export declare const DEFAULT_GATEWAY_PORT = 8321;
export declare const DEFAULT_RATE_LIMIT_PER_MINUTE = 60;
export declare const DEFAULT_MAX_CONCURRENT = 3;
export type GatewayMode = 'cloud' | 'tunnel' | 'local';
/** Gateway 认证模式（与 settings `gateway.auth` 取值一致）。 */
export type GatewayAuthMode = 'password' | 'none';
export type GatewayConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export interface GatewayConnectionState {
    status: GatewayConnectionStatus;
    mode: GatewayMode;
    /** 本地服务地址 (模式 B) */
    localUrl?: string;
    /** Tunnel 公网地址 (模式 B + tunnel) */
    tunnelUrl?: string;
    /** 认证 token */
    gatewayToken?: string;
    /** 连接时间 */
    connectedAt?: number;
    /** 错误信息 */
    error?: string;
    /** Tunnel 启动失败的原因（Gateway 本身仍正常运行） */
    tunnelError?: string;
}
/**
 * 通用入站消息格式。
 * 各平台适配器将平台特定格式转换为此格式。
 */
export interface GatewayInboundMessage {
    /** 协议版本 */
    version: typeof GATEWAY_PROTOCOL_VERSION;
    /** 消息唯一 ID */
    id: string;
    /** 消息类型 */
    type: 'message' | 'action';
    /** 消息来源 */
    source: GatewayMessageSource;
    /** 消息载荷 */
    payload: GatewayMessagePayload;
    /** 控制动作（type='action' 时使用） */
    action?: 'cancel' | 'status';
    /** 回调配置（模式 B 用于异步回传结果） */
    callback?: GatewayCallback;
    /**
     * 任务执行超时时间（毫秒）。单次消息覆盖，优先级高于 settings.gateway.runTimeoutMs。
     * 通常由 adapter 从 HTTP 请求头 `X-Codebuddy-Run-Timeout` 解析写入。
     * 设为 0 或负数表示关闭超时保护。未设置时走 settings / 默认值。
     */
    timeoutMs?: number;
}
export interface GatewayMessageSource {
    /** 平台标识 */
    platform: string;
    /** 发送者信息 */
    sender: {
        id: string;
        name?: string;
    };
    /** 会话信息 */
    conversation: {
        id: string;
        type: 'direct' | 'group';
    };
}
export interface GatewayMessagePayload {
    /** 文本内容 */
    text?: string;
    /** 附件列表 */
    attachments?: GatewayAttachment[];
}
export interface GatewayAttachment {
    type: 'image' | 'voice' | 'video' | 'file';
    /**
     * 附件位置。根据 `urlType` 解读：
     *   - 'local-path' (默认): 绝对文件系统路径，模型可用 Read 等工具直接打开
     *   - 'url':               HTTP(S) URL，模型可用 WebFetch 抓取
     */
    url: string;
    /** 原始文件名（含扩展名），供 prompt 展示 */
    name?: string;
    mimeType?: string;
    size?: number;
    /** 路径语义。未指定时按 'local-path' 处理（与适配器当前产出一致） */
    urlType?: 'local-path' | 'url';
}
export interface GatewayCallback {
    /** 回调 URL */
    url: string;
    /** 额外请求头 */
    headers?: Record<string, string>;
}
/**
 * 通用出站消息格式。
 * 各平台适配器将此格式转换为平台特定格式。
 */
export interface GatewayOutboundMessage {
    /** 协议版本 */
    version: typeof GATEWAY_PROTOCOL_VERSION;
    /** 对应的入站消息 ID */
    replyTo: string;
    /** 处理状态 */
    status: GatewayOutboundStatus;
    /** 响应内容 */
    content?: GatewayOutboundContent;
    /** Agent 执行信息 */
    agent?: GatewayAgentInfo;
    /** 错误信息 */
    error?: GatewayError;
}
export type GatewayOutboundStatus = 'accepted' | 'streaming' | 'completed' | 'error';
export interface GatewayOutboundContent {
    /** 纯文本（适合所有平台） */
    text?: string;
    /** Markdown 富文本 */
    markdown?: string;
    /** 流式片段 */
    chunk?: string;
}
export interface GatewayAgentInfo {
    /** 会话 ID */
    sessionId?: string;
    /** 工具调用列表 */
    toolCalls?: GatewayToolCallInfo[];
}
export interface GatewayToolCallInfo {
    /** 工具名称 */
    name: string;
    /** 执行状态 */
    status: 'started' | 'completed' | 'failed';
    /** 执行摘要 */
    summary?: string;
}
export interface GatewayError {
    /** 错误代码 */
    code: string;
    /** 错误描述 */
    message: string;
}
/**
 * 平台 URL 验证结果。
 * 部分平台（如企业微信）在设置回调 URL 时会发送 GET 请求做验证，
 * 适配器需返回此结构表示验证结果。
 */
export interface VerificationResult {
    /** 是否验证成功 */
    verified: boolean;
    /** 成功时的响应内容（如企微的 echostr 明文，需直接作为 HTTP 响应体返回） */
    response?: string;
    /** 失败时的错误信息 */
    error?: string;
}
/**
 * 平台适配器接口。
 * 每个支持的平台需要实现此接口，负责：
 * 1. 将平台 Webhook 请求解析为 GatewayInboundMessage
 * 2. 将 GatewayOutboundMessage 格式化为平台 API 格式
 * 3. 验证平台 Webhook 签名
 * 4. （可选）处理平台 URL 验证请求
 */
export interface PlatformAdapter {
    /** 平台标识（wecom、dingtalk、feishu、slack、generic） */
    readonly platform: string;
    /** 将平台 Webhook 请求解析为通用入站消息（支持异步，如微信客服需要拉取消息） */
    parseInbound(req: GatewayHttpRequest, config?: PlatformAdapterConfig): GatewayInboundMessage | Promise<GatewayInboundMessage>;
    /** 将通用出站消息格式化为平台 API 格式 */
    formatOutbound(msg: GatewayOutboundMessage, context: AdapterContext): unknown;
    /** 验证平台 Webhook 签名 */
    verifySignature(req: GatewayHttpRequest, config: PlatformAdapterConfig): boolean;
    /**
     * 处理平台 URL 验证请求（GET）。
     * 不是所有平台都需要此方法（如 generic 不需要）。
     * 实现了此方法的平台，webhook controller 会在 GET 请求时调用，
     * 并跳过 Gateway 自身的认证（因为平台有自己的签名机制）。
     */
    handleVerification?(req: GatewayHttpRequest, config: PlatformAdapterConfig): VerificationResult;
    /**
     * 主动发送回复消息到平台用户。
     * 在 agent 执行完成后由 bridge 调用，将最终结果推送给消息发送者。
     * 不是所有平台都支持此方法（如 generic 不需要，通过 SSE 流式输出）。
     *
     * @param userId - 目标用户 ID（来自入站消息的 source.sender.id）
     * @param content - 文本内容
     * @returns true if the message was sent successfully
     */
    sendReply?(userId: string, content: string): Promise<boolean>;
}
export interface GatewayHttpRequest {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: unknown;
    query: Record<string, string>;
}
export interface AdapterContext {
    /** 会话 ID */
    conversationId: string;
    /** 原始入站消息 */
    inboundMessage: GatewayInboundMessage;
    /** 平台特定配置 */
    platformConfig?: PlatformAdapterConfig;
}
export interface PlatformAdapterConfig {
    [key: string]: unknown;
}
export interface IGatewayAdapterRegistry {
    /** 注册适配器 */
    register(adapter: PlatformAdapter): void;
    /** 获取适配器 */
    get(platform: string): PlatformAdapter | undefined;
    /** 获取所有已注册的平台 */
    platforms(): string[];
}
/**
 * Gateway ACP Bridge 接口。
 * 核心桥接层，将 Gateway 消息转化为 AgentService 调用。
 */
export interface IGatewayAcpBridge {
    /**
     * 同步处理消息（等待完成后返回结果）。
     * 适用于模式 A (云端 Gateway) 通过 API 回传结果。
     */
    handleMessage(msg: GatewayInboundMessage): Promise<GatewayOutboundMessage>;
    /**
     * 异步流式处理消息（通过事件流回传中间结果）。
     * 适用于模式 B (本地 Gateway) 的 SSE 流式输出。
     */
    handleMessageAsync(taskId: string, msg: GatewayInboundMessage): Promise<void>;
    /**
     * 获取任务的事件流（供 SSE 端点使用）。
     */
    getTaskStream(taskId: string): Subject<GatewayOutboundMessage> | undefined;
    /**
     * 取消正在执行的任务。
     */
    cancelTask(taskId: string): boolean;
    /** 当前是否没有活跃 HTTP/Webhook 任务且所有持有会话均已空闲。 */
    isIdle(): boolean;
    /**
     * 设置主 session（交互模式的 session）。
     * 设置后，外部消息将汇聚到该 session 的消息队列中，
     * 实现终端交互和 HTTP API 共享同一个对话。
     */
    setPrimarySession(session: Session): void;
}
/**
 * Tunnel 服务接口。
 */
export interface IGatewayTunnelService {
    /** 公网 URL */
    readonly publicUrl: string | null;
    /** 启动 Quick Tunnel（零配置，临时 URL） */
    startQuickTunnel(localPort: number): Promise<string>;
    /** 启动 Named Tunnel（持久域名，需要 CF 账号） */
    startNamedTunnel(config: {
        token: string;
        hostname: string;
        cloudflaredPath?: string;
    }): Promise<string>;
    /** 停止 Tunnel */
    stop(): Promise<void>;
    /**
     * 订阅 Tunnel 进程异常退出通知（用户主动 stop 不通知）。
     * 实现方可选择支持；Gateway server 用它同步连接状态与实例注册表，
     * 避免 cloudflared 死后 /gateway status 继续报「在线 + 死地址」。
     */
    onTunnelExited?(listener: (info: {
        previousUrl: string | null;
        restoredUrl?: string;
        error?: string;
    }) => void): void;
}
/**
 * 本地 Gateway 服务接口。
 */
export interface IGatewayLocalServer {
    /** 当前连接状态 */
    readonly connectionState: GatewayConnectionState;
    /** 状态变更事件 */
    readonly onStatusChange: Subject<GatewayConnectionState>;
    /** 启动服务 */
    start(options?: GatewayStartOptions): Promise<GatewayConnectionState>;
    /** 停止服务 */
    stop(): Promise<void>;
    /** 重新生成认证密码 */
    regenerateToken(): Promise<string>;
}
export interface GatewayStartOptions {
    /** 监听端口 */
    port?: number;
    /** 是否启动 Tunnel */
    tunnel?: boolean;
    /** Tunnel 配置 */
    tunnelConfig?: {
        type: 'quick' | 'named';
        token?: string;
        hostname?: string;
        cloudflaredPath?: string;
    };
}
/**
 * `IGatewayAuthMiddleware.setup()` 的入参。
 *
 * 认证模式优先级 (高→低)：
 *   `CODEBUDDY_GATEWAY_AUTH` env > `cliAuthMode` (`--auth`) > `forceAuth` > settings `gateway.auth` > `defaultMode`
 *
 * 显式 `--auth none` 是用户明确要求的逃生门，因此可以覆盖 forceAuth；仅 settings
 * 不能覆盖 forceAuth（避免非 loopback 绑定被 settings 意外放开）。
 */
export interface GatewayAuthSetupOptions {
    /** 强制开启密码认证，忽略 settings（`/gateway` 显式启动 / tunnel 对外暴露时使用） */
    forceAuth?: boolean;
    /** CLI 显式指定的模式（`--auth`）。低于 env，高于 forceAuth/settings */
    cliAuthMode?: GatewayAuthMode;
    /**
     * 用户未做任何显式配置时的兜底模式（缺省 `'none'`）。
     *
     * `--serve` 传 `'password'` 实现 secure-by-default（issue #78178）：既翻转默认值，
     * 又保留 settings `gateway.auth: 'none'` 的显式退出路径——这是相比 `forceAuth: true`
     * 的关键差异，后者会连用户在 settings 里的显式选择一起覆盖掉。
     */
    defaultMode?: GatewayAuthMode;
}
/**
 * 认证中间件接口。
 */
/**
 * 认证中间件接口。
 * 参考 code-server 设计: 支持 password / none 两种模式。
 */
export interface IGatewayAuthMiddleware {
    /** 认证是否已启用 */
    isEnabled(): boolean;
    /**
     * 根据 settings + env 初始化认证。
     * 优先级见 {@link GatewayAuthSetupOptions}。
     * @returns 启用时返回密码，未启用时返回 undefined
     */
    setup(options?: GatewayAuthSetupOptions): Promise<{
        enabled: boolean;
        password?: string;
    }>;
    /**
     * 首次 `setup()` 完成后 resolve。与 setup 并行起步的自调用方（如 daemon 预热
     * `/internal/agent`）组请求头前须先等它，否则可能读到「未启用」而漏带 Bearer。
     */
    whenSetup(): Promise<void>;
    /** 验证请求是否已认证 */
    authenticate(req: GatewayHttpRequest): boolean;
    /**
     * 登录预检：限流窗口（分钟/小时）是否还允许一次密码尝试。
     * 登录端点必须在 `authenticate()` 之前调用；返回 false 时应直接拒绝
     * （429）且不做密码比对，否则限流对暴力破解无效。
     */
    canAttempt(): boolean;
    /** 获取当前密码 (未启用返回空) */
    getPassword(): string;
    /** 获取密码的 SHA256 哈希 (用于 Cookie 比对) */
    getHashedPassword(): string;
    /** 重新生成密码 */
    regeneratePassword(): Promise<string>;
    /** 记录一次失败的登录尝试，返回是否被限流 */
    recordFailedAttempt(): boolean;
}
/**
 * 速率限制器接口。
 */
export interface IGatewayRateLimiter {
    /** 检查是否允许请求 */
    check(senderId: string): boolean;
    /** 释放并发计数（请求完成时调用） */
    release(senderId: string): void;
    /** 重置限制 */
    reset(senderId?: string): void;
}
/**
 * CORS 服务接口。
 * 管理允许的来源列表，提供 CORS header 设置。
 */
export interface IGatewayCorsService {
    /**
     * 初始化 CORS 配置。
     * @param serverEndpoint 本地服务端点 URL (如 http://localhost:7878)
     * @param tunnelUrl 可选的 Tunnel URL
     */
    setup(serverEndpoint: string, tunnelUrl?: string): Promise<void>;
    /**
     * 添加允许的来源。
     */
    addAllowedOrigin(origin: string): void;
    /**
     * 获取请求对应的 CORS origin header 值。
     * 如果请求来源在白名单中返回该来源，否则返回 undefined。
     * @param requestOrigin 请求的 Origin header
     */
    getAllowedOrigin(requestOrigin: string | undefined): string | undefined;
    /**
     * 设置 CORS 响应头到 response 对象上。
     * @param response HTTP 响应对象
     * @param requestOrigin 请求的 Origin header
     * @returns true 如果来源被允许
     */
    applyCorsHeaders(response: any, requestOrigin: string | undefined): boolean;
}
/**
 * Host 头验证中间件接口。
 *
 * 防止 DNS Rebinding 攻击。
 * 验证请求的 Host 头是否在白名单中，防止攻击者通过 DNS 重绑定访问本地服务。
 */
export interface IHostValidationMiddleware {
    /**
     * 初始化允许的 Host 列表。
     * @param port 本地 Gateway 监听端口
     * @param tunnelUrl 可选的 Tunnel URL
     */
    setup(port: number, tunnelUrl?: string): Promise<void>;
    /**
     * 验证请求的 Host 头是否有效。
     * @param host 请求的 Host 头
     * @returns true 如果 Host 有效，false 如果应拒绝请求
     */
    isValidHost(host: string | undefined): boolean;
    /**
     * 添加自定义允许的 Host。
     */
    addAllowedHost(host: string): void;
    /**
     * 获取所有允许的 Host 列表（仅用于日志/诊断）。
     */
    getAllowedHosts(): string[];
}
/**
 * 审计事件类型。
 */
export type AuditEventType = 'connection.open' | 'connection.notification' | 'connection.close' | 'auth.success' | 'auth.failure' | 'auth.rate_limited' | 'token.issued' | 'token.revoked' | 'token.invalid' | 'cors.rejected' | 'session.created' | 'tool.executed' | 'tool.denied' | 'connection.limit_reached';
/**
 * 审计日志条目。
 */
export interface AuditEntry {
    timestamp: number;
    event: AuditEventType;
    /** 远程地址 */
    remoteAddress?: string;
    /** 连接 ID */
    connectionId?: string;
    /** 附加信息 */
    details?: Record<string, unknown>;
}
/**
 * 审计日志服务接口。
 */
export interface IGatewayAuditLog {
    /**
     * 记录审计事件。
     */
    log(event: AuditEventType, context?: {
        remoteAddress?: string;
        connectionId?: string;
        details?: Record<string, unknown>;
    }): void;
    /**
     * 获取最近的审计日志。
     * @param limit 最大条目数 (默认 100)
     */
    getRecent(limit?: number): AuditEntry[];
    /**
     * 获取指定连接的审计日志。
     */
    getByConnection(connectionId: string): AuditEntry[];
}
