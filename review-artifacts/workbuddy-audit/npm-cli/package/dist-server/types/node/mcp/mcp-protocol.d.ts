import type { Event } from '@celljs/core';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { AgentMcpServerSpec } from '@genie/product';
import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js';
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AuthorizationServerMetadata, OAuthClientInformation, OAuthClientInformationFull, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, GetPromptResult, Prompt, ReadResourceResult, Resource, ResourceTemplate, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServer as _McpServer, MCPToolFilterCallable } from '@openai/agents';
import { Subject } from 'rxjs';
import type { SSEClientTransport, StreamableHTTPClientTransport } from './mcp-sdk-values';
export type { AuthorizationServerMetadata, OAuthClientInformationFull, OAuthClientMetadata, OAuthClientProvider, OAuthDiscoveryState, SSEClientTransportOptions, StdioServerParameters, StreamableHTTPClientTransportOptions, };
export * from './mcp-sdk-values';
export declare const MCP_MIDDLEWARE_PRIORITY: number;
export declare const McpManager: unique symbol;
export declare const McpConfigManager: unique symbol;
export declare const McpConfigStore: unique symbol;
export declare const McpServerManager: unique symbol;
export declare const McpOAuthManager: unique symbol;
export declare const McpServerModelManager: unique symbol;
export declare const McpConnectionManager: unique symbol;
export declare const McpOAuthStore: unique symbol;
export declare const McpLogService: unique symbol;
export declare const McpPermissionsManager: unique symbol;
export declare const McpToggleManager: unique symbol;
export declare const McpTransportManager: unique symbol;
export declare const McpSubagentToolManager: unique symbol;
export declare const AgentScopedMcpManager: unique symbol;
export declare const McpConfigEnvExpandService: unique symbol;
export declare const McpConfigDiagnosticsManager: unique symbol;
export declare const MCP_FILENAME = ".codebuddy.json";
export declare const MCP_LOCAL_FILENAME = ".mcp.json";
export declare const MCP_IDE_FILENAME = "mcp.json";
export declare const MCP_USER_DOT_MCP_FILENAME = ".mcp.json";
export declare const MCP_CREDENTIALS_FILE = ".credentials.json";
export declare const MAX_MCP_OUTPUT_TOKENS = 20000;
export type CallToolResultContent = CallToolResult['content'];
export type McpToolResultContent = CallToolResultContent;
export type McpToolResultContentItem = McpToolResultContent[number];
export interface MCPServer extends _McpServer {
    /** Stdio initialization accepts its execution owner's lifetime signal. */
    connect(signal?: AbortSignal): Promise<void>;
    onToolsListChanged?: () => void;
    listPrompts(): Promise<McpPrompt[]>;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    /**
     * Whether the server declared the `resources` capability during the
     * `initialize` handshake.
     *
     * Reads the capability set the MCP client stored at connect time, so it is a
     * memory lookup that cannot time out or go stale while the connection lives.
     * That is what makes it a safe basis for deciding whether the resource tools
     * are offered to the model: `listResources()` answers "what is there right
     * now" and legitimately fails on a slow server, which must not be confused
     * with "this server has no resources at all" (issue #102572).
     *
     * Optional so third-party/stub implementations of this interface stay valid.
     */
    supportsResources?(): boolean;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
    /**
     * 获取服务器的指导说明（通常用于 Channel 插件）
     * 对应 MCP InitializeResult 的 instructions 字段
     */
    getInstructions?(): string | undefined;
    /**
     * 最近一次 `listTools()` 是否是「降级返回」（超时 / 错误被吞掉，回退到缓存或空表）。
     *
     * 这是区分「上游真的没有工具」和「拉取失败导致我们只是没拿到工具」的唯一依据。
     * defer 索引路径需要用它来决定是否把 tools 提交为权威结果、以及是否安排退避重试。
     * 见 issue #106255：`tools/list` 超时被当成 0 个工具永久提交，导致「连接器已连接
     * 但工具调不到」。
     *
     * 可选，第三方/桩实现无需提供。
     */
    wasListToolsDegraded?(): boolean;
    /**
     * 清除内部 `listTools` 失败冷却计时器，允许下一次调用立即真正打上游 `tools/list`。
     *
     * defer 索引退避重试路径在触发前调用，否则 30s 的 `LIST_TOOLS_RETRY_COOLDOWN_MS`
     * 会让 5s 起点的退避直接返回缓存空表 = 空转。见 issue #106255。
     *
     * 可选，第三方/桩实现无需提供。
     */
    resetListToolsCooldown?(): void;
}
export declare enum McpScope {
    PLUGIN = "plugin",
    USER = "user",
    PROJECT = "project",
    LOCAL = "local",
    DYNAMIC = "dynamic",
    /** SDK MCP Servers - 由外部 SDK（如 VS Code 扩展）注册和管理 */
    SDK = "sdk",
    INTERNAL = "internal"
}
export declare const MERGE_SCOPE_PRIORITY: readonly McpScope[];
export declare enum McpServerStatus {
    DISCONNECTED = "disconnected",
    /** Desired config is projected; transport connection has not started yet. */
    PENDING = "pending",
    CONNECTING = "connecting",
    CONNECTED = "connected",
    UNAUTHORIZED = "unauthorized",
    AUTHORIZED = "authorized",
    AUTHORIZING = "authorizing",
    PENDING_APPROVAL = "pendingApproval"
}
/**
 * MCP 工具级别配置
 */
export interface McpToolConfig {
    /** 是否延迟加载此工具 */
    defer_loading?: boolean;
    /** 透明代理：此工具所属的真实 server 名（用于 createToolProxy 重组工具名） */
    server_name?: string;
    /** 裸名暴露：不加 mcp__<server>__ 前缀，直接以原始工具名暴露给 LLM。默认 false。 */
    bare_name?: boolean;
    /** 工具定义是否适合进入稳定的 prompt-cache 前缀。 */
    prompt_cache_stability?: 'stable' | 'volatile';
    /** 由配置所有者提供的稳定工具控制 ID；Agent CLI 不从 server/tool 名称推导该值。 */
    tool_control_id?: string;
    /** 与 tool_control_id 等价的历史工具控制 ID，仅用于兼容已有设置。 */
    tool_control_compatibility_ids?: string[];
}
/**
 * Claude-compatible required-server marker.
 *
 * `alwaysLoad: true` means every tool from this server stays inline instead of
 * being deferred behind ToolSearch, and the first model dispatch may wait for
 * the server within its bounded deadline. It is the server-wide equivalent of
 * `defer_loading: false`.
 */
export interface McpAlwaysLoadConfig {
    alwaysLoad?: boolean;
    /** WorkBuddy-internal provenance marker. Never infer custom origin from transport/name. */
    _workbuddyMcpOrigin?: 'custom';
    /**
     * Real upstream origin (e.g. `https://tapd.woa.com`) projected by the host.
     * When the host fronts http/sse servers with a local reverse proxy, `url` points at that
     * proxy, so sandbox network decisions must use this instead. Absent for standalone CLI,
     * where `url` is the upstream.
     * Only honored when `url` itself is loopback, since any mcp.json can set this field.
     */
    _upstreamUrl?: string;
}
export interface McpConfigStdio extends McpAlwaysLoadConfig {
    type: 'stdio';
    command: string;
    args?: string[];
    env?: {
        [key: string]: string;
    };
    cwd?: string;
    description?: string;
    /** 是否延迟加载此服务器的所有工具 */
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false，
     * 只有显式 true 的 server 的工具才进 REPL 骨架目录 / 发现 API。
     */
    repl_expose?: boolean;
    /** 工具级别配置，key 为原始工具名 */
    tools?: Record<string, McpToolConfig>;
    /** 透明代理模式：隐藏代理 server name，用工具自带的 server_name 重组 */
    transparent_proxy?: boolean;
    /** 透明 MCP：这些工具名不加任何 mcp__ 前缀，直接裸名展示给 LLM */
    builtin_tools?: string[];
    /**
     * Where the host wants the server started. `'environment'` starts it in the
     * session's execution environment: through the session's sandbox when the
     * session enables one, as a local process otherwise. Honored for MCP servers
     * a host supplies to a served session; other paths start them as usual.
     */
    connection_origin?: 'environment';
}
export interface McpConfigSSE extends McpAlwaysLoadConfig {
    type: 'sse';
    url: string;
    headers?: {
        [key: string]: string;
    };
    description?: string;
    /** 是否延迟加载此服务器的所有工具 */
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false，
     * 只有显式 true 的 server 的工具才进 REPL 骨架目录 / 发现 API。
     */
    repl_expose?: boolean;
    /** 工具级别配置，key 为原始工具名 */
    tools?: Record<string, McpToolConfig>;
    /** 透明代理模式：隐藏代理 server name，用工具自带的 server_name 重组 */
    transparent_proxy?: boolean;
    /** 透明 MCP：这些工具名不加任何 mcp__ 前缀，直接裸名展示给 LLM */
    builtin_tools?: string[];
}
export interface McpConfigHTTP extends McpAlwaysLoadConfig {
    type: 'http';
    url: string;
    headers?: {
        [key: string]: string;
    };
    description?: string;
    /** 是否延迟加载此服务器的所有工具 */
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false，
     * 只有显式 true 的 server 的工具才进 REPL 骨架目录 / 发现 API。
     */
    repl_expose?: boolean;
    /** 工具级别配置，key 为原始工具名 */
    tools?: Record<string, McpToolConfig>;
    /** 透明代理模式：隐藏代理 server name，用工具自带的 server_name 重组 */
    transparent_proxy?: boolean;
    /** 透明 MCP：这些工具名不加任何 mcp__ 前缀，直接裸名展示给 LLM */
    builtin_tools?: string[];
}
export interface McpConfigRemote extends McpAlwaysLoadConfig {
    type: 'remote';
    url: string;
    headers?: {
        [key: string]: string;
    };
    description?: string;
    /** 是否延迟加载此服务器的所有工具 */
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false，
     * 只有显式 true 的 server 的工具才进 REPL 骨架目录 / 发现 API。
     */
    repl_expose?: boolean;
    /** 工具级别配置，key 为原始工具名 */
    tools?: Record<string, McpToolConfig>;
    /** 透明代理模式：隐藏代理 server name，用工具自带的 server_name 重组 */
    transparent_proxy?: boolean;
    /** 透明 MCP：这些工具名不加任何 mcp__ 前缀，直接裸名展示给 LLM */
    builtin_tools?: string[];
}
export interface McpConfigIDE extends McpAlwaysLoadConfig {
    type: 'ws-ide' | 'sse-ide';
    url: string;
    ideName: string;
    authToken?: string;
    ideRunningInWindows?: boolean;
    description?: string;
    /** 是否延迟加载此服务器的所有工具 */
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false，
     * 只有显式 true 的 server 的工具才进 REPL 骨架目录 / 发现 API。
     */
    repl_expose?: boolean;
    /** 工具级别配置，key 为原始工具名 */
    tools?: Record<string, McpToolConfig>;
    /** 透明代理模式：隐藏代理 server name，用工具自带的 server_name 重组 */
    transparent_proxy?: boolean;
    /** 透明 MCP：这些工具名不加任何 mcp__ 前缀，直接裸名展示给 LLM */
    builtin_tools?: string[];
}
/**
 * SDK MCP Server 配置
 *
 * SDK MCP Server 是一种特殊类型的 MCP 服务器，它不通过标准的 stdio 或 HTTP 传输层通信，
 * 而是通过 CLI 程序内部的 control_request/control_response 消息机制进行通信。
 *
 * 使用场景：IDE/SDK 集成时，由外部 SDK（如 VS Code 扩展）注册和管理的 MCP 服务器。
 */
export interface McpConfigSDK extends McpAlwaysLoadConfig {
    type: 'sdk';
    /** 服务器名称标识 */
    name: string;
    description?: string;
    defer_loading?: boolean;
    /**
     * 是否把此服务器的工具暴露给 code mode（REPL sandbox）。白名单语义：默认 false。
     */
    repl_expose?: boolean;
    /** Tool projection options also apply to a host-provided in-process instance. */
    tools?: Record<string, McpToolConfig>;
    transparent_proxy?: boolean;
    builtin_tools?: string[];
    /**
     * 进程内 MCP Server 实例（agent-sdk-js `createSdkMcpServer()` 的 `instance`，
     * 即 @modelcontextprotocol/sdk 的 McpServer）。提供时走 InMemoryTransport
     * 进程内直连（/server 库形态：宿主 tool() 处理器与内核同进程）；缺省时
     * 走 control_request/response 控制通道（stream-json SDK 拓扑）。
     * 运行时引用，不参与 config 指纹与序列化。
     */
    instance?: unknown;
}
/** Host-owned standard MCP connection. The factory returns a fresh, unstarted client Transport. */
export interface McpConfigTransport extends Omit<McpConfigSDK, 'type' | 'name' | 'instance'> {
    type: 'transport';
    transport: () => Transport | Promise<Transport>;
    /** Credential-free source facts supplied by the transport owner for the existing network guards. */
    source?: {
        type: 'http' | 'sse';
        url: string;
    } | {
        type: 'stdio';
        managedBrowser: boolean;
    };
}
export type McpConfig = McpConfigStdio | McpConfigSSE | McpConfigHTTP | McpConfigRemote | McpConfigIDE | McpConfigSDK | McpConfigTransport;
export type InArgv<T extends McpConfig> = Partial<Omit<T, 'type'>> & {
    transport: T['type'];
};
export type ArgvMcpConfig = InArgv<McpConfigStdio> | InArgv<McpConfigSSE> | InArgv<McpConfigHTTP> | InArgv<McpConfigRemote> | InArgv<McpConfigIDE> | InArgv<McpConfigSDK>;
export type PartialMcpConfig = Partial<McpConfigStdio> | Partial<McpConfigSSE> | Partial<McpConfigHTTP> | Partial<McpConfigRemote> | Partial<McpConfigIDE> | Partial<McpConfigSDK> | Partial<McpConfigTransport>;
export interface ScopedMcpConfig<T extends McpConfig = McpConfig> {
    scope: McpScope;
    config: T;
}
export type McpTransportType = McpConfig['type'];
/**
 * 传输类型别名 → 规范 {@link McpTransportType} 映射。
 *
 * 背景（issue #69950）：IDE 侧（agent-craft）按 MCP 生态约定用 `streamableHttp`，
 * 而 CLI 的规范值是 `http`。同一份 `~/.codebuddy/mcp.json` 在 IDE 正常、CLI 直接抛
 * `no valid transport type`。这里把所有等价写法（kebab / camel / snake）归一到 CLI
 * 规范值，让 downstream 的 switch（server-manager / env-expand / controller）零改动。
 *
 * key 用小写：{@link normalizeTransportAlias} 先原样查一次、再 `toLowerCase()` 查一次，
 * 因此 `streamableHttp`(camel) 命中 `streamablehttp`。
 */
export declare const TRANSPORT_ALIASES: Record<string, McpTransportType>;
/**
 * 把传输类型别名归一到规范 {@link McpTransportType}。命中别名返回规范值；未知返回
 * undefined（调用方应保留原值走后续 `no valid transport type` 错误路径，不吞异常）。
 * 见 {@link TRANSPORT_ALIASES}。
 */
export declare function normalizeTransportAlias(type: string | undefined): McpTransportType | undefined;
export interface McpDataValue {
    [serverName: string]: McpConfig;
}
export interface PartialMcpDataValue {
    [serverName: string]: PartialMcpConfig;
}
export interface McpData {
    mcpServers: McpDataValue;
    disabledMcpServers: string[];
}
export type McpProjectData = McpData;
export type McpUserData = McpData & {
    /** project scope settings */
    projects?: {
        [cwd: string]: McpData;
    };
};
/**
 * Bump when persisted DCR metadata changes and existing clients must register again.
 * v2: application_type + refresh_token grant；没有 refresh token 的旧注册在下一次授权时重新 DCR。
 */
export declare const MCP_OAUTH_CLIENT_METADATA_VERSION = 2;
export interface McpOAuthInfo {
    serverName: string;
    serverUrl: string;
    accessToken: string;
    tokenType: string;
    idToken?: string | undefined;
    refreshToken?: string;
    expiresAt: number;
    scope?: string;
    clientId?: string;
    clientSecret?: string;
    clientMetadataVersion?: number;
}
export type McpOAuthStoreKey = string;
export interface McpOAuthStoreData {
    mcpOAuth?: {
        [key: McpOAuthStoreKey]: McpOAuthInfo;
    };
}
export interface McpOAuthStoreResult {
    success: boolean;
    warning?: string;
}
export interface McpServerModel {
    readonly name: string;
    readonly scope: McpScope;
    readonly config: McpConfig;
    status: McpServerStatus;
    needsAuth: boolean;
    isActive(): boolean;
    /** for OAuth state management */
    state(): string;
    error?: string;
}
export interface OAuthCallbackResult {
    success: boolean;
    serverName?: string;
    operation?: 'connect' | 'authenticate';
    error?: string;
}
export interface McpConfigManager {
    /**
     * Emits whenever a scope's config is mutated or its source policy changes.
     * Subscribers (notably `McpManager`) use this to invalidate caches that
     * were computed before the new servers were known — e.g. the headless
     * pre-warm `list()` running before ACP middleware writes DYNAMIC scope.
     */
    changedSubject: Subject<{
        scope: McpScope;
    }>;
    get(scope: McpScope, name: string): Promise<McpConfig>;
    set(scope: McpScope, configs: McpDataValue): Promise<void>;
    set(scope: McpScope, name: string, config: McpConfig): Promise<void>;
    delete(scope: McpScope, name: string): Promise<boolean>;
    list(): Promise<Record<McpScope, McpDataValue>>;
    list(scope: McpScope): Promise<McpDataValue>;
    /**
     * Read the USER declarations as data without activating the process-local
     * MCP runtime.
     *
     * This is the descriptor-only seam used by the shared Resource API. It
     * deliberately ignores `--strict-mcp-config` (which controls runtime
     * materialization) while still honoring `--setting-sources user`, normalizes
     * transport aliases and expands environment placeholders through the same
     * codec as ordinary MCP loading. The result may contain credentials and
     * must remain behind a credential-capable private transport.
     */
    listDeclaredUser?(cwd: string): Promise<McpData>;
    setStrictDynamic(strictDynamic: boolean): void;
    /** Whether ambient Plugin/user/project/local MCP sources are disabled. */
    isStrictMcpConfig(): boolean;
    getByName(name: string): Promise<ScopedMcpConfig[]>;
    /**
     * Drop the cached config for filesystem-backed scopes so the next read
     * re-loads from disk.
     *
     * Always invalidates cwd-derived PROJECT + LOCAL: called on cwd changes
     * (prewarm activate chdir, worktree switch). Without this, a PROJECT/LOCAL
     * scope read that happened at the old cwd (e.g. a prewarm cold-start before
     * activate) stays cached and the new workspace's `.mcp.json` is never
     * picked up.
     *
     * When `opts.includeUser` is set (prewarm activate ONLY), also invalidates
     * the cwd-independent USER scope: a prewarm standby process may read
     * `~/.codebuddy/.mcp.json` before it exists (caching an empty scope), so
     * activate must re-read it for user-scope MCP servers written after standby
     * to load. Ordinary cwd changes leave USER cached (no churn).
     *
     * Emits `changedSubject` per invalidated scope so `McpManager` re-scans if
     * it had already settled.
     */
    invalidateFilesystemScopeCaches(opts?: {
        includeUser?: boolean;
    }): void;
    /** Drop only the runtime plugin scope after publishing a new active snapshot. */
    invalidatePluginScopeCache?(): void;
    /**
     * 等待动态配置初始化完成
     * 用于确保 --mcp-config 参数已被解析
     */
    waitDynamicConfigInitialized(): Promise<void>;
}
export interface McpConfigStore {
    read(scope: McpScope): McpData | undefined;
    /** Read LOCAL state for an explicit cwd without mutating process cwd. */
    readLocalForProject?(projectPath: string): McpData | undefined;
    update(scope: McpScope, data: McpData): McpData | undefined;
    delete(scope: McpScope): void;
    /** Whether the latest read found no candidate file for this scope. */
    isMissing?(scope: McpScope): boolean;
    /** Drop cached missing-file observations after a watched or in-process change. */
    invalidate?(scope?: McpScope): void;
    getLocation(scope: McpScope): McpConfigLocation;
}
export interface McpServerModelManager {
    changedSubject: Subject<McpServerModel>;
    create(scope: McpScope, name: string, config: McpConfig): McpServerModel;
    /** if got `undefined`, make sure you'v created it */
    get(name: string, scope?: McpScope): McpServerModel | undefined;
    /** Drop one cached model before projecting a replacement generation. */
    delete?(scope: McpScope, name: string): void;
    /** Drop cached models owned by one scope before an explicit runtime rebuild. */
    deleteScope?(scope: McpScope): void;
}
export interface McpTransportManager {
    createStdio(options: StdioServerParameters): Promise<Transport>;
    /**
     * Start a stdio server in the current execution environment: through the
     * sandbox when its settings enable one on a supported platform, as a local
     * process otherwise. Call it inside the session's sandbox execution.
     */
    createEnvironmentStdio(options: StdioServerParameters): Promise<Transport>;
    /** Whether {@link createEnvironmentStdio} starts servers through the sandbox in the current execution. */
    isEnvironmentSandboxed(): Promise<boolean>;
    create(name: string, options: StdioServerParameters): Promise<Transport>;
    create(name: string, options: SSEClientTransportOptions): Promise<SSEClientTransport>;
    create(name: string, options: StreamableHTTPClientTransportOptions): Promise<StreamableHTTPClientTransport>;
    get(name: string): Promise<Transport | undefined>;
    delete(name: string, expectedTransport?: Transport): Promise<void>;
}
export interface McpConnectionManager {
    connect(serverModel: McpServerModel): Promise<McpServerModel>;
    disconnect(serverModel: McpServerModel): Promise<McpServerModel>;
    reconnect(serverModel: McpServerModel): Promise<McpServerModel>;
    /** Wait until an in-flight connect for one server name has settled. */
    waitForIdle?(name: string): Promise<void>;
}
export interface McpToggleManager {
    toggleSubject: Subject<{
        serverName: string;
        disabled: boolean;
    }>;
    disable(serverNames: string | string[]): Promise<void>;
    enable(serverNames: string | string[]): Promise<void>;
    isDisabled(serverName: string): boolean;
}
export interface McpOAuthStore {
    read(): McpOAuthStoreData | null;
    /**
     * Capture one immutable, descriptor-only OAuth presence view. Reading it
     * never refreshes credentials or starts an authorization flow.
     */
    snapshotCredentialPresence?(): {
        hasCredentials(serverName: string, config: McpConfig): boolean;
    };
    update(data: McpOAuthStoreData): McpOAuthStoreResult;
    delete(name: string): void;
    saveTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP, tokens: OAuthTokens): McpOAuthStoreResult;
    loadTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP): OAuthTokens | undefined;
    deleteMcpOAuthTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP): boolean;
    saveMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP, clientInfo: OAuthClientInformation, clientMetadataVersion?: number): McpOAuthStoreResult;
    loadMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP, expectedClientMetadataVersion?: number): OAuthClientInformation | undefined;
    deleteMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP): boolean;
    areTokensExpired(tokens: McpOAuthInfo | null, bufferSeconds?: number): boolean;
    clear(): boolean;
}
export interface McpOAuthManager {
    getProvider(name: string): Promise<OAuthClientProvider | undefined>;
    unauthenticate(name: string): Promise<void>;
    handleOAuthCallback(code: string, state: string): Promise<OAuthCallbackResult>;
    invalidateCredentials(serverName: string, scope?: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void>;
    getAuthorizationUrl(serverName: string): Promise<string | undefined>;
}
export interface McpPermissionsManager {
    isAllowed(serverName: string, scope?: McpScope): Promise<boolean>;
    approve(serverNames: string[]): Promise<void>;
    deny(serverNames: string[]): Promise<void>;
    approveAll(): Promise<void>;
    getServersNeedingConfirmation(): Promise<string[]>;
}
export interface McpServerManager {
    toolsListChangedSubject: Subject<string>;
    create(name: string, config: McpConfig): Promise<MCPServer>;
    /**
     * Create a session-private server outside the global registries. `environment` starts a stdio
     * server through {@link McpTransportManager.createEnvironmentStdio}; connect it inside the
     * session's sandbox execution.
     */
    createIsolated(name: string, config: McpConfig, options?: {
        session?: Session;
        toolFilter?: MCPToolFilterCallable;
        environment?: boolean;
        /**
         * The session a stdio server asks the shell environment policy for, recorded
         * when its owner started; without it the server asks nothing.
         */
        policySessionId?: string;
        scope?: McpScope;
    }): Promise<MCPServer>;
    get(name: string): Promise<MCPServer | undefined>;
    delete(name: string): Promise<boolean>;
    clear(): Promise<void>;
    getAll(): AsyncIterableIterator<MCPServer>;
    /** Wait until an in-flight create/replacement for one server name has settled. */
    waitForIdle?(name: string): Promise<void>;
}
export interface McpLogService {
    log(name: string, message: string): void;
}
/**
 * MCP 工具短描述在 `_meta` 里的 key。
 *
 * 上游 MCP server（如 workbuddy-server 的 connector-proxy）可把一句话摘要写到
 * tool `_meta[TOOL_SHORT_DESCRIPTION_META_KEY]`，索引延迟工具时优先用它作为
 * ToolSearch 清单摘要（`name: summary` 格式），比完整 description 更精简。
 *
 * 注意：必须与 workbuddy-server 侧常量保持一致（见
 * packages/workbuddy-server/src/connector/mcp-config.ts 的 TOOL_SHORT_DESCRIPTION_META_KEY）。
 */
export declare const TOOL_SHORT_DESCRIPTION_META_KEY = "shortDescription";
/**
 * **notice:** mcp tool name format like `mcp__serverName__rawToolName`
 */
export type McpTool = Tool & {
    needsApproval?: boolean;
    permissionAliases?: string[];
};
export type McpPrompt = Prompt;
export type McpResource = Resource;
export type McpResourceTemplate = ResourceTemplate;
export type McpToolProperties = Record<string, {
    type: string;
    description: string;
}>;
export interface McpLocation {
    /** Scope name */
    scope: McpScope;
    /** File path */
    path: string;
    /** Nested field path (e.g., projects[/path/to/project]) */
    nestedPath?: string;
}
export interface McpConfigLocation {
    /** Configuration file path */
    filePath: string;
    /** Project path (for LOCAL scope only) */
    projectPath?: string;
}
export interface OAuthState {
    codeVerifier: string;
    codeChallenge: string;
    authorizationUrl: string;
    tokenUrl: string;
    /**
     * Authorization server discovery result captured during the initial `auth()` call
     * that produced `authorizationUrl` (RFC 9728 protected resource metadata +
     * RFC 8414 authorization server metadata).
     *
     * `handleOAuthCallback` reuses this instead of re-running discovery from scratch,
     * because a fresh `discoverOAuthProtectedResourceMetadata(config.url)` call only probes
     * the *standard* well-known paths and misses resource-specific metadata paths that are
     * only discoverable via the `WWW-Authenticate: resource_metadata="..."` header seen on
     * the original 401 (RFC 9728 §5.1). Falling back to re-discovery in that case silently
     * picks the wrong authorization server (the MCP resource URL itself), which breaks the
     * token exchange (issue #73980).
     */
    discoveryState?: OAuthDiscoveryState;
}
export declare const DefaultMcpConfig: McpData;
export interface McpManager {
    /**
     * Event that fires once when the MCP Server status has changed
     */
    readonly serverCollectionSubject: Subject<McpServerModel[]>;
    /**
     * Event that fires when OAuth authentication completes (success or failure)
     */
    readonly oauthCompletionSubject: Subject<{
        serverName: string;
        success: boolean;
        error?: string;
    }>;
    /**
     * Add an MCP server configuration
     */
    add(name: string, config: McpConfig, scope?: McpScope): Promise<void>;
    /**
     * Remove an MCP server configuration
     */
    remove(name: string, scope?: McpScope): Promise<void>;
    /**
     * Get a specific MCP server configuration with connection status
     */
    get(name: string, scope?: McpScope): Promise<McpServerModel | undefined>;
    /**
     * List all MCP server configurations with connection status
     */
    list(scope?: McpScope): Promise<McpServerModel[]>;
    /**
     * Names currently owned by the effective PLUGIN projection. This is a
     * synchronous snapshot of the runtime already visible to the session.
     */
    getProjectedPluginServerNames?(): readonly string[];
    /**
     * Resolve which candidate plugin MCP names would win after applying the
     * normal cross-scope priority, without publishing or connecting them.
     */
    previewEffectivePluginServerNames?(pluginConfigs: McpDataValue): Promise<readonly string[]>;
    /**
     * Reconcile MCP servers from the active plugin snapshot. Resolves when the
     * diff is projected; new/replaced transports may still be pending.
     */
    reloadPluginServers?(): Promise<void>;
    /**
     * List available tools from a specific MCP server
     */
    listTools(name: string, scope?: McpScope): Promise<McpTool[]>;
    /**
     * Get all tools from all MCP servers
     */
    getServerAllTools(): Promise<Map<string, McpTool[]>>;
    /**
     * Get all configuration file locations across scopes
     */
    getLocations(): Promise<McpLocation[]>;
    /**
     * Reconnect a specific MCP server by name
     * @param name Server name to reconnect
     * @returns True if server was found and reconnected successfully
     */
    reconnect(name: string): Promise<boolean>;
    /**
     * Start OAuth authentication flow for a server
     * @param name Server name to authenticate
     * @returns Authorization URL to redirect user to
     */
    startOAuthFlow(name: string): Promise<string>;
    /**
     * Check if a server has valid OAuth tokens
     * @param name Server name to check
     * @returns True if server has valid tokens
     */
    hasValidOAuthTokens(name: string): Promise<boolean>;
    /**
     * Invalidate OAuth credentials for a server
     * @param name Server name to invalidate
     * @param credentialScope What to invalidate ('all', 'client', 'tokens', 'verifier')
     */
    invalidateOAuthCredentials(name: string, credentialScope?: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void>;
    /**
     * Get all connected MCP servers
     * Returns the same array reference when the connected servers haven't changed
     * for optimization purposes
     * @param options.waitForSettle 是否有界等待当前 server settle（默认 false）。
     *   默认立即返回当前已连接快照，不等仍在 PENDING/CONNECTING 的 server —— 供不该被
     *   慢 MCP 阻塞的元信息路径使用（如 MCP prompt → slash command 派生），MCP 连完后
     *   status 变化会触发 ProductManager 重新 sync 补齐。
     * @returns Promise that resolves to an array of connected MCP server instances
     */
    getConnectedServers(options?: {
        waitForSettle?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MCPServer[]>;
    /**
     * Bounded wait for currently projected pending/connecting servers. With no
     * names, waits for the current eligible snapshot only; never waits for a
     * future config revision.
     */
    waitForPendingServers?(options?: {
        names?: readonly string[];
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    /**
     * Projection of the exact server set `waitForPendingServers` would block on
     * for the same `names` filter. Used by the first-run banner so the displayed
     * set == the set that actually blocks the first prompt. Awaits `list()`
     * internally to populate the cache before reading (same as waitForPendingServers).
     */
    listPendingOrUncommittedServerNames?(options?: {
        names?: readonly string[];
    }): Promise<string[]>;
    /** Bounded targeted wait used by flows that require one concrete server. */
    waitForServer?(name: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MCPServer | undefined>;
    /**
     * Get all scopes where a specific server exists
     * @param name Server name to check
     * @returns Array of scopes containing the server
     */
    getServerScopes(name: string): Promise<McpScope[]>;
    /**
     * Set non-interactive mode status
     * @param nonInteractive Whether in non-interactive mode
     */
    setNonInteractiveMode(nonInteractive: boolean): void;
    /**
     * Approve MCP servers by names
     * @param serverNames Array of server names to approve
     */
    allow(serverNames: string[]): Promise<void>;
    /**
     * Deny MCP servers by names
     * @param serverNames Array of server names to deny
     */
    deny(serverNames: string[]): Promise<void>;
    /**
     * Use all future MCP servers in this project
     */
    allowAllForever(): Promise<void>;
    /**
     * Get all needing approval McpServer names
     */
    getAllNeedingApproval(): Promise<string[]>;
    /**
     * enable/disable a specific McpServer
     */
    toggleServer(name: string, enable: boolean): Promise<void>;
    /**
     * Check if a specific McpServer is disabled
     */
    isServerDisabled(name: string): boolean;
    /**
     * Get a prompt from an MCP server
     * @param serverName The name of the MCP server
     * @param promptName The name of the prompt
     * @param args args to pass to the prompt
     * @returns The prompt result with messages
     */
    getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
}
export interface InitializeResult {
    protocolVersion: string;
    capabilities: {
        tools: Record<string, unknown>;
    };
    serverInfo: {
        name: string;
        version: string;
    };
    instructions?: string;
}
/**
 * Owns MCP servers that are scoped to a single subagent session.
 *
 * Do not confuse this with McpSubagentToolManager below: that older manager is
 * only an agent-name tool whitelist over global MCP servers. This manager owns
 * actual per-session MCP server instances created from agent `mcpServers`
 * frontmatter/product config.
 */
export interface AgentScopedMcpManager {
    /** Invalidates derived tool views without putting session tools in the global index. */
    readonly onDidChangeTools: Event<void>;
    /** Create/borrow MCP servers for one subagent session. Safe to call repeatedly; old state for the session is cleaned first. */
    setupForSubAgent(input: {
        session: Session;
        agentName: string;
        agentSource?: string;
        /** True only for agents explicitly supplied by --agents / SDK initialize. */
        isFlagSettingsAgent?: boolean;
        specs: AgentMcpServerSpec[];
        strictMcpConfig?: boolean;
        /**
         * Keep stdio servers marked `connection_origin: 'environment'` for
         * {@link startEnvironmentServers} instead of connecting them here.
         * Set by the served session lane, which activates outside the
         * session's sandbox execution.
         */
        deferEnvironmentServers?: boolean;
        /** Registration provenance supplied by the host, never read from MCP config/_meta. */
        scope?: McpScope;
    }): Promise<void>;
    /**
     * Start the session's deferred environment servers. Call it inside the
     * session's sandbox execution: at turn start, and again before the run's
     * first model request, once the run has prepared its sandbox. A local
     * server connects at the first call; a sandboxed one connects once the
     * sandbox is ready, and again after each sandbox restart. Like the
     * first-run MCP gate, the first call with a connection to wait for waits,
     * once per execution, up to the session's first-run MCP wait: the value
     * its host states (QueryOptions.mcpFirstPromptWaitMs), else
     * `CODEBUDDY_FIRST_RUN_MCP_PREWAIT_TIMEOUT_MS`. A slower server keeps
     * connecting and its tools appear once it connects. Each connection gets
     * the session's connect limit (QueryOptions.mcpConnectTimeoutMs), else
     * the inline one.
     */
    startEnvironmentServers(session: Session, signal?: AbortSignal): Promise<void>;
    /**
     * Whether the session has environment servers. They can connect after a
     * run builds its agent, so the run reads the session's servers live.
     */
    hasEnvironmentServers(session: Session | undefined): boolean;
    /** Return this session's scoped servers and those inherited from live ancestors. */
    getServers(sessionId: string): MCPServer[];
    /** Return visible inline servers with their original configs and registration provenance. */
    getInlineServers(sessionId: string): Array<{
        server: MCPServer;
        config: McpConfig;
        scope?: McpScope;
    }>;
    /** Merge own, inherited and global servers, in that precedence order. */
    getMergedServers(session: Session | undefined, globalServers: MCPServer[]): MCPServer[];
    /** Close inline servers owned by this session; borrowed global servers are left untouched. */
    cleanup(sessionId: string): Promise<void>;
}
/** 工具的形态，供 {@link McpSubagentToolManager.isToolAllowed} 选择匹配口径。 */
export interface McpToolAllowOptions {
    /**
     * 该工具是透明代理（connector、WorkBuddy 内置工具）的裸名工具，不是 SDK Host builtin。
     * 非空且不含 mcp__* 的白名单不约束它，与 CE 丢弃这类清单的结果一致；显式空清单仍隐藏。
     */
    transparentProxyBareName?: boolean;
}
export interface McpSubagentToolManager {
    /**
     * 注册 agent 允许的 MCP 工具列表
     * @param agentName agent 名称
     * @param mcpTools MCP 工具列表,格式可以是 mcp__serverName__toolName 或透明代理裸名
     */
    register(agentName: string, mcpTools: string[]): void;
    /**
     * 获取 agent 允许的 MCP 工具列表
     * @param agentName agent 名称
     * @returns MCP 工具列表,如果没有限制则返回 undefined
     */
    getTools(agentName: string): string[] | undefined;
    /**
     * 检查 agent 是否允许使用指定的 MCP 工具
     *
     * 匹配语义分层:白名单为空（未注册）时全放行;白名单里没有任何 mcp__* 条目时,
     * 视为不表达 MCP 命名空间意图,只约束裸名工具、放行 mcp__serverName__toolName,
     * 其中透明代理的裸名工具（{@link McpToolAllowOptions.transparentProxyBareName}）
     * 在非空清单下也放行、显式空清单仍隐藏;其余情况按精确匹配。
     *
     * @param agentName agent 名称
     * @param toolName MCP 工具名称
     * @param options 工具的形态
     * @returns true 表示允许,false 表示拒绝
     */
    isToolAllowed(agentName: string, toolName: string, options?: McpToolAllowOptions): boolean;
    /**
     * 清除 agent 的工具白名单
     * @param agentName agent 名称
     */
    unregister(agentName: string): void;
    /**
     * 清除所有注册信息
     */
    clear(): void;
}
export declare const SdkMcpMessageClient: unique symbol;
/**
 * SDK MCP 消息客户端接口
 *
 * 负责通过 control_request/control_response 机制与 SDK 端的 MCP 服务器通信。
 */
export interface SdkMcpMessageClient {
    /**
     * 发送 MCP 消息到 SDK 端的 MCP 服务器
     * @param serverName MCP 服务器名称
     * @param message MCP 协议消息（JSON-RPC 格式）
     * @param signal 可选的 AbortSignal，用于取消请求
     * @returns MCP 响应消息
     */
    sendMcpMessage(serverName: string, message: unknown, signal?: AbortSignal): Promise<unknown>;
    /**
     * 处理来自 SDK 的 control_response
     * @param requestId 请求 ID
     * @param response 响应数据（ControlResponse 或 ControlErrorResponse）
     */
    handleResponse(requestId: string, response: unknown): void;
    /**
     * 取消挂起的请求
     * @param requestId 请求 ID
     */
    cancelRequest(requestId: string): void;
    /**
     * 取消所有挂起的请求
     * @param reason 取消原因
     */
    cancelAllPending(reason: string): void;
}
export declare const McpReadyService: unique symbol;
/**
 * 轻量级服务，用于触发 MCP 配置投影，并兼容旧的有界就绪观察。
 *
 * 这个服务独立于 McpManager，避免循环依赖问题。
 * 网络连接本身不再是进程级 readiness barrier。
 */
export interface McpReadyService {
    /**
     * 触发 headless MCP 配置初始化后返回，不等待外部 MCP 网络连接。
     */
    waitForServersReady(): Promise<void>;
    /**
     * 不区分模式（TUI / Headless 都生效）地等待 MCP 服务器就绪，最多等待 `timeoutMs` 毫秒。
     *
     * 与 `waitForServersReady()` 不同：
     * - 不会跳过 TUI 模式
     * - 不触发 McpCliConfigInitializer 初始化（仅消费现有的就绪信号）
     * - 超时不抛错，仅 resolve（调用方按"未就绪"继续处理）
     *
     * 用于在描述/提示词渲染等"赶得上就用真实状态、赶不上就退化"的场景。
     *
     * @param timeoutMs 超时上限（毫秒）
     */
    waitFor(timeoutMs: number): Promise<void>;
    /**
     * 标记服务器已就绪（由 McpManager 调用）
     */
    resolve(): void;
}
export declare const McpCliConfigInitializer: unique symbol;
/**
 * 从命令行参数初始化 MCP 配置
 *
 * 专门处理 --mcp-config 参数，在 SDK 模式下 middleware 未执行时提供初始化。
 */
export interface McpCliConfigInitializer {
    /**
     * 初始化 MCP 动态配置并触发服务器连接
     *
     * 处理流程:
     * 1. 解析 --mcp-config 参数并设置 DYNAMIC scope
     * 2. 设置非交互模式触发 MCP 服务器连接
     *
     * 此方法幂等，可安全多次调用。
     * 仅在存在 --mcp-config 参数时执行。
     */
    initialize(): void;
}
/**
 * Diagnostic severity level for MCP config issues
 */
export declare enum McpConfigDiagnosticSeverity {
    ERROR = "error",
    WARNING = "warning",
    INFO = "info"
}
/**
 * Diagnostic information for MCP config issues
 */
export interface McpConfigDiagnostic {
    /** Server name that has the issue */
    serverName: string;
    /** Scope where the config is defined */
    scope: McpScope;
    /** Severity of the diagnostic */
    severity: McpConfigDiagnosticSeverity;
    /** Human-readable message describing the issue */
    message: string;
    /** Category of the diagnostic (e.g., 'env-expansion') */
    category: string;
    /** Timestamp when the diagnostic was created */
    timestamp: Date;
    /** Additional metadata (e.g., missing variable names) */
    metadata?: Record<string, unknown>;
}
/**
 * Result of expanding environment variables in an MCP config
 */
export interface McpConfigEnvExpandResult {
    /** The config with environment variables expanded */
    config: McpConfig;
    /** Diagnostics generated during expansion */
    diagnostics: McpConfigDiagnostic[];
}
export interface McpConfigEnvExpandOptions {
    /** Explicit environment snapshot; callers must not temporarily mutate process.env. */
    environment?: Readonly<NodeJS.ProcessEnv>;
    /** Suppress diagnostics whose variable names belong to a private descriptor boundary. */
    suppressDiagnostics?: boolean;
    /** Suppress value previews for private descriptor expansion. */
    suppressLogging?: boolean;
}
/**
 * Service for expanding environment variables in MCP configurations
 */
export interface McpConfigEnvExpandService {
    /**
     * Expand environment variables in an MCP config.
     *
     * Detects `${VAR_NAME}` patterns and replaces them with values from the
     * explicit environment snapshot, defaulting to `process.env`.
     * Missing variables are left as-is and reported in diagnostics.
     *
     * @param name - Server name (for diagnostic reporting)
     * @param config - The MCP config to expand
     * @param scope - The scope where the config is defined
     * @returns The expanded config and any diagnostics
     */
    expandConfig(name: string, config: McpConfig, scope: McpScope, options?: McpConfigEnvExpandOptions): McpConfigEnvExpandResult;
}
/**
 * Manager for collecting and reporting MCP config diagnostics
 */
export interface McpConfigDiagnosticsManager {
    /**
     * Add a diagnostic to the collection
     */
    addDiagnostic(diagnostic: McpConfigDiagnostic): void;
    /**
     * Add multiple diagnostics at once
     */
    addDiagnostics(diagnostics: McpConfigDiagnostic[]): void;
    /**
     * Get all diagnostics
     */
    getDiagnostics(): McpConfigDiagnostic[];
    /**
     * Get diagnostics for a specific server
     */
    getDiagnosticsForServer(serverName: string): McpConfigDiagnostic[];
    /**
     * Get diagnostics for a specific server and scope
     */
    getDiagnosticsForServerScope(serverName: string, scope: McpScope): McpConfigDiagnostic[];
    /**
     * Get the count of diagnostics by severity
     */
    getDiagnosticCount(severity?: McpConfigDiagnosticSeverity): number;
    /**
     * Check if there are any diagnostics (optionally filtered by severity)
     */
    hasDiagnostics(severity?: McpConfigDiagnosticSeverity): boolean;
    /**
     * Clear all diagnostics
     */
    clearDiagnostics(): void;
    /**
     * Clear diagnostics for a specific server
     */
    clearServerDiagnostics(serverName: string): void;
    /**
     * Clear diagnostics for a specific server and scope
     */
    clearServerScopeDiagnostics(serverName: string, scope: McpScope): void;
    /**
     * Subject that emits when diagnostics change
     */
    readonly changedSubject: Subject<McpConfigDiagnostic[]>;
}
