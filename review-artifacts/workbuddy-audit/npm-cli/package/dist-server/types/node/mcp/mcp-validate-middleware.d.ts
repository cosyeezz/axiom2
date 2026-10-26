import { PathResolver } from '@celljs/web';
import { Context, Middleware, RequestMatcher } from '@celljs/web/lib/node';
import { ConsoleManager } from '../console';
import { McpConfigManager, McpManager } from './mcp-protocol';
export declare class McpValidateMiddleWare implements Middleware {
    protected readonly mcpManager: McpManager;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly consoleManager: ConsoleManager;
    protected readonly requestMatcher: RequestMatcher;
    protected readonly pathResolver: PathResolver;
    readonly priority: number;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    private canHandle;
    /**
     * Process MCP config from CLI parameter.
     *
     * Supports JSONC format with:
     * - Single-line comments (//)
     * - Multi-line comments (/* *\/)
     * - Trailing commas
     *
     * @param mcpConfigParam - JSON string or file path to config
     */
    private processMcpConfig;
}
