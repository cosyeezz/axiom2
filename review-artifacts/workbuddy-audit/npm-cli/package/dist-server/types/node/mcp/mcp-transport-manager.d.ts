import { Logger } from '@celljs/core';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { SettingsManager } from '../settings';
import { McpConfigManager, McpOAuthManager, McpTransportManager, SSEClientTransport, SSEClientTransportOptions, StdioServerParameters, StreamableHTTPClientTransport, StreamableHTTPClientTransportOptions } from './mcp-protocol';
export declare class McpTransportManagerImpl implements McpTransportManager {
    protected readonly mcpOAuthManager: McpOAuthManager;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly logger: Logger;
    protected readonly sandboxLifecycle?: ISandboxCLILifecycle;
    protected readonly settingsManager?: SettingsManager;
    private readonly transportCache;
    private getCacheKey;
    /** stdio 的 spawn 参数含 cwd：不同 cwd 各建一条缓存，避免同 key 复用错子进程。 */
    private getStdioCacheKey;
    private matchesNamedCacheKey;
    /**
     * 只返回无 cwd 维度的缓存（http/sse）。stdio 缓存键带 cwd，前缀回退会把别的
     * cwd（其他会话）的子进程误发给调用方；按 cwd 复用 stdio transport 一律走
     * `create(name, { cwd })`，同一 cwd 自然命中同一条缓存。
     */
    get(name: string): Promise<Transport | undefined>;
    create(name: string, options: StdioServerParameters): Promise<Transport>;
    create(name: string, options: SSEClientTransportOptions): Promise<SSEClientTransport>;
    create(name: string, options: StreamableHTTPClientTransportOptions): Promise<StreamableHTTPClientTransport>;
    createStdio(options: StdioServerParameters): Promise<Transport>;
    createEnvironmentStdio(options: StdioServerParameters): Promise<Transport>;
    isEnvironmentSandboxed(): Promise<boolean>;
    private createSandboxedStdio;
    private isSandboxEnabled;
    private createSSETransport;
    private createHTTPTransport;
    delete(name: string, expectedTransport?: Transport): Promise<void>;
}
