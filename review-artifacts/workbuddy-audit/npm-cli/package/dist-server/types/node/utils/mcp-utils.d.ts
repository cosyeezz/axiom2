import * as fs from 'fs';
import { McpConfig } from '../mcp/mcp-protocol';
/**
 * Connection ceiling for MCP servers connected on the session activation path
 * (session / subagent inline MCP). Hosts give `session/prompt` a 60s ACK budget
 * and the ACK waits for activation; the SDK's 60s default alone would spend it.
 */
export declare const INLINE_MCP_CONNECT_TIMEOUT_MS = 30000;
/** Type for a fetch-like function accepted by the MCP SDK's HTTP/SSE transports. */
type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;
/**
 * Sideband key carrying our MCP tool-call timeout through `RequestInit` so
 * `FetchProxy` (fetch-proxy.ts) can apply it to the `ProxyAgent` it builds
 * when a system/PAC proxy is in effect. Necessary because `FetchProxy`
 * monkey-patches `globalThis.fetch` process-wide and unconditionally
 * overwrites `init.dispatcher` with its own `ProxyAgent` whenever a proxy
 * applies — silently discarding our `Agent`'s `headersTimeout`/`bodyTimeout`
 * and reintroducing undici's 300_000ms default for any proxied MCP call
 * (issue #76466 follow-up). `FetchProxy` reads this hint and deletes it
 * before the real network call — it is never sent to the MCP server.
 */
export declare const MCP_TOOL_TIMEOUT_HINT_KEY = "__mcpToolTimeoutMs";
export declare abstract class McpUtils {
    /**
     * Get the timeout (in milliseconds) for MCP server connection
     *
     * This is used for initial server connection timeout.
     *
     * @returns Timeout in milliseconds or undefined (uses SDK default)
     *
     * @example
     * ```typescript
     * const timeout = McpUtils.getMcpTimeout();
     * const server = new MCPServer({ timeout });
     * ```
     *
     * @example
     * ```bash
     * # Use SDK default timeout
     * codebuddy
     *
     * # Custom timeout: 30 seconds
     * MCP_TIMEOUT=30000 codebuddy
     *
     * # Custom timeout: 2 minutes
     * MCP_TIMEOUT=120000 codebuddy
     * ```
     */
    static getMcpTimeout(): number | undefined;
    /**
     * Connection timeout for an inline (session / subagent) MCP server: its own
     * `timeout` field, then `MCP_TIMEOUT`, then {@link INLINE_MCP_CONNECT_TIMEOUT_MS}.
     * Inline servers connect inside session activation, which the host's prompt
     * ACK waits on, so they must not inherit the SDK's 60s default (#146512).
     * A served session's environment servers carry the session's connect limit
     * (QueryOptions.mcpConnectTimeoutMs) as `timeout`.
     */
    static getInlineMcpConnectTimeout(config: object): number;
    /**
     * Get the timeout (in milliseconds) for MCP tool calls
     *
     * This is used for tools that require user interaction (like openDiff)
     * where the user may need significant time to review and respond.
     *
     * @returns Timeout in milliseconds (default: 3.6e6 ms = 1 hour)
     *
     * @example
     * ```typescript
     * const timeout = McpUtils.getToolTimeout();
     * await client.callTool({ name: 'openDiff', arguments: args }, undefined, { timeout });
     * ```
     *
     * @example
     * ```bash
     * # Use default timeout (1 hour)
     * codebuddy
     *
     * # Custom timeout: 5 minutes
     * MCP_TOOL_TIMEOUT=300000 codebuddy
     *
     * # Custom timeout: 1 hour
     * MCP_TOOL_TIMEOUT=3600000 codebuddy
     * ```
     */
    static getToolTimeout(): number;
    private static toolFetchCache;
    /**
     * Fetch implementation for HTTP/SSE MCP transports whose underlying socket
     * timeouts are bound to {@link getToolTimeout} instead of Node's undici
     * default.
     *
     * Background (issue #76466): `StreamableHTTPClientTransport` /
     * `SSEClientTransport` are constructed without a custom `fetch`, so they
     * fall back to `globalThis.fetch` — which is backed by an undici client
     * whose `headersTimeout`/`bodyTimeout` **both default to 300_000ms (5
     * minutes)**. That transport-level ceiling fires long before the MCP
     * JSON-RPC-level `RequestOptions.timeout` (`getToolTimeout()`, default
     * ~27.7h) ever gets a chance to apply, so a slow-but-alive MCP server
     * (e.g. a downstream `subagent_spawn` call queued behind model latency)
     * gets killed with a generic `UND_ERR_HEADERS_TIMEOUT` at ~5 minutes
     * regardless of `MCP_TOOL_TIMEOUT`.
     *
     * This binds an `undici.Agent` with matching `headersTimeout`/`bodyTimeout`
     * so the two timeout layers stay consistent. The dispatcher is cached and
     * only rebuilt when the effective timeout or the CA bundle changes (e.g.
     * `MCP_TOOL_TIMEOUT` read differently across calls in tests, or a CA
     * hot-reload).
     *
     * The Agent also trusts the same CA bundle as the axios-based paths (see
     * {@link getToolFetchCaBundle}) so private-CA MCP gateways don't fail the
     * undici TLS handshake.
     *
     * Under bun (see {@link isBun}), `dispatcher` has no effect — falls back to
     * `AbortSignal.timeout()` composed with any caller-supplied signal via
     * `AbortSignal.any()` (both runtimes support it) so the transport's own
     * abort (e.g. `close()`) still works alongside our timeout.
     */
    static getToolFetch(): FetchLike;
    /**
     * Node 分支下的实际 fetch 执行：假设 undici 已 preload；
     * 命中 dispatcher 缓存（同 timeout + CA bundle）复用，否则重建。
     */
    private static doNodeToolFetch;
    /**
     * CA bundle for the MCP fetch dispatcher, sourced from the same
     * {@link CertificateManager} the axios path uses, so internal-CA MCP
     * gateways that `curl` can reach don't fail undici's TLS handshake.
     * Returns an empty array when the manager isn't resolvable (defensive:
     * container not ready in tests / standalone contexts) — the dispatcher
     * then falls back to Node's default trust store.
     */
    private static getToolFetchCaBundle;
    /**
     * 为 Promise 添加超时保护，防止在 headless 模式下无限挂起
     *
     * 使用 Promise.race 实现超时，超时后执行回调并 resolve。
     * Timer 使用 unref() 确保不会阻止 Node.js 进程退出。
     *
     * @param promise - 需要添加超时保护的 Promise
     * @param onTimeout - 超时时执行的回调
     * @param timeoutMs - 超时时间（毫秒），默认使用 MCP_TIMEOUT 环境变量或 30s
     */
    static raceWithTimeout(promise: Promise<void>, onTimeout: () => void, timeoutMs?: number): Promise<void>;
    static parseToolFullName(fullName: string): {
        serverName: string;
        toolName: string;
        fullName: string;
    };
    /**
     * 检查 MCP 服务器是否有任何 defer_loading 配置
     * 用于快速判断是否需要处理 defer 逻辑
     */
    static hasDeferLoadingConfig(config: McpConfig): boolean;
    /**
     * 从完整工具名中提取原始工具名
     * mcp__serverName__toolName -> toolName
     */
    static getRawToolName(fullToolName: string): string;
    /**
     * 构建完整的 MCP 工具名
     * toolName + serverName -> mcp__serverName__toolName
     */
    static buildFullToolName(serverName: string, rawToolName: string): string;
    /**
     * 构造在 McpConfig.tools 里查 defer_loading 等 tool 级配置的候选名（顺序即优先级）。
     *
     * 兼容用户配置的不同 key 形式:裸名 / serverName__toolName / mcp__serverName__toolName。
     * transparent_proxy 下 tools map 的 key 是 proxy 内部名 `${realServer}_${rawTool}`
     * （如 ardot_create_design),而对外工具名已被 createToolProxy 改写成
     * `mcp__realServer__rawTool`,上面三种形式都命中不了,必须额外还原内部名并排在最前;
     * 否则 connector 工具只能落到 server 级 defer 策略上（#80575）。
     *
     * 调用方（LLM tools[] 过滤 / deferred 索引）必须共用本函数,两侧查名不一致会让同一个
     * 工具既进 tools[] 又进 ToolSearch 索引,弱模型仍可能挑 DeferExecuteTool 那条路。
     *
     * @param serverName 工具所属的 MCP server 名（transparent_proxy 下是代理层名）
     * @param toolName 对外工具名(可能是 mcp__server__tool，也可能是裸名)
     * @param transparentProxy 该 server 是否开启透明代理
     */
    static buildDeferLookupNames(serverName: string, toolName: string, transparentProxy?: boolean): string[];
    static writeConfigFileAtomic(filePath: string, data: string, options?: Exclude<fs.WriteFileOptions, null | string>): void;
    /**
     * Parse a JSONC (JSON with Comments) string.
     *
     * Supports:
     * - Single-line comments (//)
     * - Multi-line comments (/* *\/)
     * - Trailing commas
     *
     * @param content - The JSONC string to parse
     * @returns Parsed JSON object
     * @throws Error if parsing fails
     *
     * @example
     * ```typescript
     * const config = McpUtils.parseJsonc(`{
     *   // This is a comment
     *   "mcpServers": {
     *     "my-server": {
     *       "command": "node",
     *       "args": ["server.js"], // trailing comma allowed
     *     }
     *   }
     * }`);
     * ```
     *
     * @deprecated Use JsonUtils.parse() instead
     */
    static parseJsonc<T = unknown>(content: string): T;
    /**
     * Stringify an object to JSONC format, preserving comments if they exist.
     *
     * @param value - The value to stringify
     * @param space - Number of spaces for indentation (default: 2)
     * @returns Formatted JSON string
     *
     * @example
     * ```typescript
     * const jsonString = McpUtils.stringifyJsonc({ mcpServers: {} }, 2);
     * ```
     *
     * @deprecated Use JsonUtils.stringify() instead
     */
    static stringifyJsonc(value: unknown, space?: number): string;
}
export {};
