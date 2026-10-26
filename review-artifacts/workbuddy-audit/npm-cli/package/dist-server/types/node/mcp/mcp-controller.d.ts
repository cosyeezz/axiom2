import { ConsoleManager } from '../console';
import { McpConfig, McpConfigManager, McpConnectionManager, McpManager, McpScope, McpServerManager, McpTool, McpTransportType } from './mcp-protocol';
export interface McpScopeOptions {
    scope?: McpScope;
}
export interface McpNameRequest extends McpScopeOptions {
    name: string;
}
export interface McpServerRequestBase extends McpNameRequest {
    args?: string[];
    env?: string[];
    header?: string[];
    description?: string;
}
export interface McpAddRequest extends McpServerRequestBase {
    commandOrUrl: string;
    transport: McpTransportType;
}
export interface McpUpdateRequest extends McpServerRequestBase {
    commandOrUrl?: string;
    transport?: McpTransportType;
}
export interface McpAddJsonRequest extends McpNameRequest {
    json: McpConfig;
}
export declare class McpController {
    protected readonly mcpManager: McpManager;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly mcpConnectionManager: McpConnectionManager;
    protected readonly mcpServerManager: McpServerManager;
    protected readonly consoleManager: ConsoleManager;
    add(request: McpAddRequest): Promise<void>;
    remove(request: McpNameRequest): Promise<void>;
    get(request: McpNameRequest): Promise<void>;
    list(request: McpScopeOptions): Promise<void>;
    addJson(request: McpAddJsonRequest): Promise<void>;
    listTools(request: McpNameRequest): Promise<McpTool[]>;
    /**
     * Get MCP server connection status
     * Used by workbuddy-desktop to poll connection state after /add
     */
    status(request: McpNameRequest): Promise<{
        name: string;
        status: string;
        needsAuth: boolean;
        error?: string;
    }>;
    /**
     * Get OAuth authorization URL for a server that needs authentication
     * Used by workbuddy-desktop to open browser for OAuth
     */
    oauthAuthorize(request: McpNameRequest): Promise<{
        authorizationUrl?: string;
        error?: string;
    }>;
}
