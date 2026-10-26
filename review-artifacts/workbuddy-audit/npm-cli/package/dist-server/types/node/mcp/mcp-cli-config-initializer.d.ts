import { McpCliConfigInitializer, McpManager } from './mcp-protocol';
/**
 * 从命令行参数初始化 MCP 配置
 *
 * 专门处理 --mcp-config 参数，在 SDK 模式下 middleware 未执行时提供初始化。
 */
export declare class McpCliConfigInitializerImpl implements McpCliConfigInitializer {
    protected readonly mcpManager: McpManager;
    private initialized;
    initialize(): void;
    /**
     * Initialize DYNAMIC scope from --mcp-config command line args.
     *
     * Supports both JSON/JSONC strings and file paths, consistent with
     * McpValidateMiddleWare.processMcpConfig.
     */
    private initDynamicConfigFromArgs;
}
