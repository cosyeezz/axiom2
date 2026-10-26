import { Logger } from '@celljs/core';
import type { McpConfig } from '../../../../../node/mcp/mcp-protocol.js';
import { PluginEnvironmentContext } from '../plugin-environment';
import { PluginOptionsStorage } from '../plugin-options-storage';
import { McpBundleEntry, PluginErrorCollector, PluginExtensionType } from '../plugin-protocol';
/**
 * MCP 服务器加载器
 * 从扩展目录中加载 MCP 服务器配置
 * 支持配置路径和默认扫描的合并
 */
export declare class MCPExtensionLoader {
    readonly type = PluginExtensionType.MCP;
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected readonly pluginOptionsStorage?: PluginOptionsStorage;
    protected init(): void;
    /**
     * 加载 MCP 服务器配置
     * 如果提供了 mcpConfig 配置，则加载指定配置；否则默认扫描 mcp.json 和 mcp 目录
     * 两种方式的结果会被合并
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称（用于标记）
     * @param mcpConfig 可选的 MCP 配置，可以是文件路径或直接的配置对象
     * @param mcpBundles 可选的 MCP Bundle 列表
     * @returns MCP 服务器配置对象
     */
    load(extensionDir: string, extensionName: string, mcpConfig?: string | Record<string, McpConfig>, mcpBundles?: McpBundleEntry[], pluginEnvironment?: PluginEnvironmentContext): Promise<Record<string, McpConfig>>;
    /**
     * 从配置加载 MCP 服务器
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称
     * @param mcpConfig MCP 配置，可以是文件路径或直接的配置对象
     * @returns MCP 服务器配置对象
     */
    private loadFromConfig;
    /**
     * 从 mcp.json 配置文件加载 MCP 服务器
     */
    private loadFromConfigFile;
    /**
     * 从 mcp 目录扫描加载 MCP 服务器配置
     */
    private loadFromDirectory;
    private pathExists;
    /**
     * Parse MCP server config file.
     *
     * Supports JSONC format with:
     * - Single-line comments (//)
     * - Multi-line comments (/* *\/)
     * - Trailing commas
     *
     * @param filePath - Path to the config file
     * @returns MCP server configurations
     */
    private parseServerConfigFile;
    private enrichWithPluginEnvironment;
    /**
     * 当 MCP 配置未显式声明 `type` 时，按现有字段推断出完整类型。
     * 推断规则与 mcp-config-manager.normalizePartialData 保持一致：
     *   - `command`  → stdio
     *   - `ideName`  → ws-ide
     *   - `url`      → http
     * 若已有合法 `type`（stdio/sse/http/remote/ws-ide/sse-ide），原样返回。
     * 若既无 `type` 也无法推断，返回 `null` 表示应跳过。
     */
    private inferTypeIfMissing;
    /**
     * 推断是否为扁平的 MCP server 配置格式
     * 当没有 mcpServers 字段时，检查每个顶层 entry 的 value 是否包含 command 或 url 字段
     * @param config 解析后的配置对象
     * @returns 如果是扁平格式则返回配置对象，否则返回空对象
     */
    private inferFlatFormat;
}
//# sourceMappingURL=mcp-loader.d.ts.map