import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { EventService } from '@genie/telemetry';
import { Subject } from 'rxjs';
import { ConsoleManager } from '../console';
import { TokenCalculator } from '../context/token-calculator/token-calculator-protocol';
import { EndpointProvider } from '../loopback';
import { HostCapabilityProvider } from '../runtime/host-capability-provider';
import { type SensitiveToolEgressGuard as SensitiveToolEgressGuardInterface } from '../sensitive-content';
import { type ToolControlPolicy as ToolControlPolicyService } from '../tool-control';
import { CallToolResultContent, McpConfig, McpScope, MCPServer, McpServerManager, McpServerModelManager, type McpToolConfig, MCPToolFilterCallable } from './mcp-protocol';
export { computeMcpConfigFingerprint, diffMcpConfigFingerprint } from './mcp-config-fingerprint';
/**
 * 检查 MCP headers 是否已包含用户显式配置的静态 Authorization（Basic / Bearer）。
 *
 * Bug #32741: 若用户在 mcp.json 的 `headers.Authorization` 中已显式提供 Basic/Bearer 凭证，
 * 应跳过 OAuth provider 创建，防止 SDK 在收到 401 时无条件进入 OAuth discovery / redirectToAuthorization。
 *
 * 匹配规则（RFC 7235，auth-scheme 大小写不敏感）：
 * - scheme 必须是 `basic` 或 `bearer`
 * - scheme 后必须跟至少一个空白 + 至少一个非空白字符（凭证值）
 * - 同时兼容 `Authorization` 和 `authorization` 两种 header key
 */
export declare function hasStaticAuthorization(headers?: Record<string, string>): boolean;
/**
 * Compare two MCP configs (or any nested snapshot) and report **changed key
 * paths only**. Used by reconcile replacement logs so we can see why a
 * same-name slot was evicted without writing header/env/token values.
 */
export declare function diffMcpConfigKeyPaths(before: unknown, after: unknown): string;
/**
 * Human-readable reason for a same-name MCP runtime replacement. Keys only;
 * never interpolates config values (headers/env often hold tokens).
 */
export declare function formatMcpRuntimeReplacementReason(input: {
    previousScope: string;
    nextScope: string;
    previousAllowed?: boolean;
    nextAllowed: boolean;
    previousConfig: unknown;
    nextConfig: unknown;
    hasRuntimeSlot: boolean;
}): string;
/**
 * 无 ToolSearch 时 defer 默认被忽略（工具摊进首轮）。日历 11 个入口不能走这条：
 * ask / 快速问答没有 ToolSearch，忽略 defer 等于把完整 schema 塞进首轮。
 */
export declare function shouldHonorMcpDeferLoading(serverName: string, hasToolSearch: boolean): boolean;
interface McpConfigDerived {
    transparentProxy: boolean;
    customOrigin: boolean;
    /**
     * 进程内 sdk-instance 形（host 自持实例——数据配置无法伪造活对象，即信任
     * 判据本体）。裸名规则：builtin_tools 声明的工具直传裸名，与 transparent_proxy
     * 同一条改名分支但概念独立——不借用 connector 代理语义（E25 续判例）。
     */
    sdkInstance: boolean;
    builtinSet: Set<string> | undefined;
    toolsConfig: Record<string, McpToolConfig> | undefined;
}
export declare class McpServerManagerImpl implements McpServerManager {
    private readonly mcpOAuthManager;
    protected readonly tokenCalculator: TokenCalculator;
    protected readonly consoleManager: ConsoleManager;
    protected readonly eventService: EventService;
    protected readonly endpointProvider: EndpointProvider;
    protected readonly hostCapabilityProvider: HostCapabilityProvider;
    protected readonly logger: Logger;
    protected readonly toolControlPolicy?: ToolControlPolicyService;
    /**
     * 稳定 proxy 外壳缓存（按 name）。
     *
     * 关键不变量：**外壳对象一旦创建就永不替换**。它被 `buildMcpServers()` 取走
     * frozen 进 `agent.mcpServers`，agent run 时 OpenAI agents-core 直接对这个外壳
     * 调 `listTools()/callTool()`。外壳内部所有操作动态转发到 `underlyingCache`
     * 里当前 name 对应的**活底层实例**，因此底层实例被重建（A→B）时无需重建 agent，
     * agent 抓着的外壳引用始终指向活实例。
     *
     * 背景（prewarm present_files 漏装竞态）：prewarm 命中后 connector-proxy 的
     * config 指纹变化（headers 注入 session-id / bearer）会触发 `create()` 销毁旧
     * 底层实例 A、重建 B。旧实现里 serverCache 存的就是绑定到 A 的 proxy，agent 在
     * A 上 frozen 后 A 被 delete（session=null），run 时 `A.listTools()` 因
     * `!this.session` 静默返回 []，agents-core 无 tool 可 filter → connector-proxy
     * 的非延迟工具（present_files/automation_update/widget_guidelines/show_widget）全部进不了
     * LLM 工具列表。稳定外壳 + 动态底层解析消除该竞态。
     */
    private readonly serverCache;
    protected readonly sensitiveToolEgressGuard?: SensitiveToolEgressGuardInterface;
    protected readonly mcpServerModelManager?: McpServerModelManager;
    /**
     * 底层实例缓存（按 name）。proxy 外壳通过它解析当前活实例；config 指纹变化时
     * 这里的实例被替换（A→B），但 serverCache 里的外壳保持不变。
     */
    private readonly underlyingCache;
    /**
     * 已成功 connect 过的底层实例集合（按实例身份）。
     *
     * 背景（swap-during-connect 竞态，cloudagent defer_loading:false builtin 工具消失）：
     * config 指纹变化触发重建时，`doConnect` 可能在 `serverManager.get()` 拿到外壳后、
     * `disposeUnderlying(A)+install(B)` 完成**之前**就开始 `server.connect()`；由于外壳
     * 每次访问都 `resolveTarget()` 取活实例，早期捕获的 connect 调用连到的是已被 dispose
     * 的 A，却把 `serverModel.status` 置为 CONNECTED。此后 connect 幂等短路，活实例 B 永不
     * connect，`listTools/getPrompts` 全部 "Server not initialized"，bare-name builtin 工具
     * 静默从模型工具列表消失。
     *
     * 修复：外壳 `connect` 分支在**调用时**重新解析活实例并只连它；用本集合按**实例身份**
     * 记连接状态（而非 serverModel.status），确保重建换出的新实例一定会被 connect 一次。
     * WeakSet 语义让被 GC 的旧实例自动移除，无需在 dispose 时清理。
     */
    private readonly connectedUnderlyings;
    /**
     * 每个活底层实例正在进行的 connect() Promise（按实例身份去重，防并发重复 connect
     * 撞 "transport already started"）。用 WeakMap 让实例被 GC 时自动回收。
     */
    private readonly connectingUnderlyings;
    /** Raw catalog cache before the SDK applies an Agent-specific toolFilter. */
    private toolCatalogs?;
    private static readonly TOOL_CATALOG_TTL_MS;
    private authorizeMcpEgress;
    /**
     * 每个 name 当前生效的 config（proxy 外壳动态读取它派生 transparentProxy /
     * builtinSet / toolsConfig）。
     *
     * 背景（present_files 前缀回归）：稳定外壳被 frozen 进 agent 后永不替换，但底层
     * 实例 + config 会因指纹变化被重建（典型：user-scope 的 `.mcp.json`
     * connector-proxy 只有 url、无 `builtin_tools`/`transparent_proxy`，先建外壳；
     * 随后 dynamic-scope 带完整 `builtin_tools` 落地触发重建）。若外壳闭包捕获首次
     * （user-scope）config，则 builtinSet=undefined，present_files 等内置裸名工具会被
     * createToolProxy 误加 `mcp__connector-proxy__` 前缀。改为从本 map 动态读当前
     * config，重建时同步更新，外壳即可始终用最新 config 派生项。
     */
    private readonly configByName;
    /**
     * 每个 name 正在进行的 create() Promise（并发去重锁）。
     *
     * 背景（prewarm present_files 漏装竞态，真因）：`McpManager.doListAll` 的
     * Phase3 对每个 scope 轮（user / dynamic / ...）都 fire-and-forget 调
     * `serverManager.create(name, config)`，且不 await。`instantiateServer` 是 async，
     * 于是同一 name 的两次 create 并发执行——两个调用都在对方 `set` 之前求值
     * `serverCache.has(name)===false`，各自新建底层实例 + 各自覆盖 serverCache /
     * underlyingCache。结果：先建的实例 A 完成了 indexDeferred（_toolsList 填好），
     * 但被后建的实例 B 覆盖；B 连上后因 `indexedDeferServers` 已含该 name 不再
     * indexDeferred，其 `_toolsList` 永远空。run 时 agents-core 对 B 调
     * `listTools()` 返回 [] → filterTools 无 tool 可遍历 → connector-proxy 的非延迟
     * 工具（present_files 等）进不了 LLM 工具列表。
     *
     * 用 per-name in-flight Promise 串行化同 name 的并发 create：第二个调用直接复用
     * 第一个的结果（指纹一致时），避免重复 instantiate + 覆盖。指纹变化的合法重建
     * 仍按顺序执行（前一个 settle 后再跑），不会丢实例。
     */
    private readonly creating;
    /**
     * 每个缓存 server 实例构建时所用 config 的稳定指纹。
     *
     * serverCache 只按 name 缓存，但同一个 name 的 config 在一次会话里可能被
     * **替换**——典型是 prewarm 命中后：第一次 create() 用的是预热基线的 dynamic
     * 配置（connector-proxy 只有 url、没有 activate 才注入的
     * `Authorization: Bearer <secret>`），随后真实配置（带 bearer）落地触发
     * McpManager rescan 再次 create()。若只按 name 命中，rescan 会复用第一次那个
     * **挂了 OAuth authProvider 的 stale 实例**（因为构建时 headers 无静态
     * Authorization，hasStaticAuthorization 返回 false），连接 connector-proxy 一直
     * 401 → SDK OAuth 兜底把纯文本 "Not Found" 当 JSON 解析 → 误导性的
     * `HTTP 404: Invalid OAuth error response` → 整轮 disconnected，widget_guidelines 等所有
     * connector 工具不注册。
     *
     * 记录指纹后，config 变化（headers 多了 bearer）即指纹变化 → 丢弃旧实例重建为
     * 带静态 bearer、不挂 OAuth provider 的实例，rescan 自愈。
     */
    private readonly serverConfigFingerprint;
    readonly toolsListChangedSubject: Subject<string>;
    private readonly mockLogger;
    create(name: string, config: McpConfig): Promise<MCPServer>;
    createIsolated(name: string, config: McpConfig, options?: {
        session?: Session;
        toolFilter?: MCPToolFilterCallable;
        environment?: boolean;
        policySessionId?: string;
        scope?: McpScope;
    }): Promise<MCPServer>;
    /**
     * Each start of a session's stdio server asks the shell environment policy
     * once. Its variables go below the env the declaration carries, which go
     * below the variables the Agent sets for the server.
     */
    private withShellEnvironment;
    waitForIdle(name: string): Promise<void>;
    private doCreate;
    /**
     * 按 config.type 构造底层 MCP server 实例（不含缓存/proxy 包装）。
     *
     * 单独抽出来既保持 `create()` 的缓存语义清晰，也给单测一个无需触网/构造真实
     * SDK transport 的 seam（子类可 override）。`http`/`sse` 分支保留 Bug #32741
     * 的「静态 Authorization 存在则不挂 OAuth provider」逻辑。
     */
    protected instantiateServer(name: string, config: McpConfig, toolFilter?: MCPToolFilterCallable, isolated?: boolean, environment?: boolean): Promise<MCPServer | undefined>;
    /**
     * 仅关闭并移除某个 name 的**底层实例**，保留 serverCache 里的稳定 proxy 外壳。
     * 用于 config 指纹变化的重建路径（A→B）：底层换掉，外壳不动，agent 抓的引用仍有效。
     *
     * onToolsListChanged 解绑只针对被丢弃的旧底层实例；新底层实例在 create() 里会
     * 重新绑定回调。
     */
    private disposeUnderlying;
    get(name: string): Promise<MCPServer | undefined>;
    delete(name: string): Promise<boolean>;
    clear(): Promise<void>;
    getAll(): AsyncIterableIterator<MCPServer>;
    private closeServerSafely;
    private listRawToolsCached;
    private catalogCache;
    /**
     * 创建 SDK MCP Server 实例
     *
     * SDK MCP Server 通过 control_request/response 机制与 SDK 端通信，
     * 不通过标准的 stdio 或 HTTP 传输层。
     */
    private createSdkMcpServer;
    private static resolveConfigDerived;
    /**
     * Creates a proxy for the server that filters listTools output to match McpManagerImpl's filtering
     */
    protected createServerProxy(name: string, _config: McpConfig, resolveTargetOverride?: () => MCPServer, resolveConfigDerivedOverride?: () => McpConfigDerived): MCPServer;
    private static createToolProxy;
    private static createMcpNeedsApproval;
    private authorizeMcpFinalAction;
    private recordMcpRiskExecutionStatus;
    private recordMcpResultIdentity;
    private recordMcpResultOutcome;
    private createToolFilter;
    static maxOutputTokens(): number;
    /**
     * 构造 MCP `tools/call._meta` 中 `workbuddy.ai/*` 字段，透传 connector_invoke
     * 埋点上下文到 workbuddy-desktop ConnectorProxyServer（Issue #33295）。
     *
     * 仅在 WorkBuddy Desktop 宿主下生效；其他场景返回 undefined，避免给非
     * WorkBuddy 宿主（VSCode / Cursor / 独立 CLI 等）的 MCP 请求带上无意义负担。
     *
     * 注意：在 WorkBuddy Desktop 下此 \_meta 会附加到**所有** MCP server 的
     * tools/call 请求上（包括用户自定义 MCP、ardot 等），不仅仅是 connector-proxy。
     * MCP 协议允许服务器忽略未知 \_meta 字段，因此对第三方 MCP server 无功能影响。
     */
    private static buildWorkBuddyInvokeMeta;
    /**
     * 上报 mcp_tool_call 埋点（仅 WorkBuddy Desktop 宿主下触发）。
     *
     * 字段契约对齐 VSCode 源头（packages/agent-mcp/src/common/services/mcp-client-service.ts）：
     *   - id:                 MCP server ID；agent-cli 无该字段，留空串
     *   - name:               MCP server name（从 full tool name `mcp__server__tool` 解析）
     *   - toolName:           原始工具名（裸名，去除 mcp__ 前缀）
     *   - toolArgs:           JSON 字符串化的工具参数
     *   - toolCallSuccessful: 成功 true / 失败 false
     *   - source/type:        agent source/type；agent-cli 无稳定来源，留空串
     *   - requestId:          session.conversationRequestId
     *   - messageId:          session.messageId
     *
     * @param fullToolName 原始传入的工具名（可能为 `mcp__server__tool` 或透传后的裸名）
     * @param strippedToolName 去除 mcp__ 前缀并用于调用 underlying session 的工具名
     * @param args 调用参数
     * @param successful 是否成功
     * @param session 当前 session（若可用）
     * @param durationMs 本次 MCP 网络往返耗时（ms），不含 hook 开销
     */
    private static reportMcpToolCall;
    /**
     * MCP 响应超大处理（对齐 Claude Code processMCPResult 行为）。
     *
     * 旧版 `checkTokenUsage` 超限直接 throw，会中断整轮 turn 且丢失数据；
     * 新版改为：
     *   1. 未超限 → 原样返回
     *   2. env `CODEBUDDY_DISABLE_MCP_LARGE_OUTPUT_FILES=1` / 含 image / 无 session / 落盘失败 → 截断降级
     *   3. 其他 → 写入会话 tool-results 目录，返回单条 text 指引
     *
     * @param content   上游返回的内容数组
     * @param maxTokens token 上限（字符数 = tokens × 4）
     * @param serverName MCP server 名（用于文件名）
     * @param toolName  工具名（用于文件名）
     * @param session   当前 session；无 session 时降级到截断（避免落盘孤儿文件）
     */
    static processMcpResult(content: CallToolResultContent, maxTokens: number, serverName: string, toolName: string, session?: Session): Promise<CallToolResultContent>;
}
/**
 * 把 mockLogger 透传的 error/warn 参数序列化成单条日志文本。
 *
 * SDK 调用形如 `logger.error('[cbc-kw=MCP] Error initializing MCP server:', e)`（message + Error 对象
 * 分开传），而 CellJS Logger 的 error/warn 只收 `(message, context?)`，直接透传会把
 * Error 对象丢掉。这里把每个 arg 转成字符串拼起来：Error 取 stack（含 cause 链），
 * 其余对象走脱敏后的 JSON.stringify（敏感 key 见 redactSensitiveKeys），序列化失败
 * 时用 String() 兜底。
 */
export declare function formatMcpLoggerArgs(args: unknown[]): string;
/**
 * 递归脱敏：key 命中敏感模式时把值替换为占位符，避免 SDK 传入的 request
 * headers / 凭据对象被 JSON.stringify 原样写进本地日志文件。
 *
 * 只递归普通对象；Date/Map/Set/RegExp 等非 POJO 原样返回，由外层
 * JSON.stringify 决定其表示（如 Date 的 toJSON），避免坍缩成空 `{}`。
 */
export declare function redactSensitiveKeys(value: unknown): unknown;
