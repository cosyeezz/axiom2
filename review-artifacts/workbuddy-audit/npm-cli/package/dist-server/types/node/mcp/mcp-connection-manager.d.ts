import { Logger } from '@celljs/core';
import { McpConnectionManager, McpLogService, McpOAuthManager, McpServerManager, McpServerModel } from './mcp-protocol';
export declare class McpConnectionManagerImpl implements McpConnectionManager {
    /**
     * De-dupe concurrent connect() calls per server name.
     *
     * Without this, repeated connect() calls (e.g. from init + `mcp get`)
     * can re-use a cached transport and cause: "StdioClientTransport already started".
     */
    private readonly inFlightConnects;
    protected readonly mcpLogService: McpLogService;
    protected readonly mcpOAuthManager: McpOAuthManager;
    protected readonly mcpServerManager: McpServerManager;
    protected readonly logger: Logger;
    /**
     * Connect to an MCP server
     * @param server The server model to connect to
     * @returns Updated server model with connection status
     */
    connect(serverModel: McpServerModel): Promise<McpServerModel>;
    waitForIdle(name: string): Promise<void>;
    private doConnect;
    /**
     * Disconnect from an MCP server
     * @param serverModel The server model to disconnect from
     * @returns Updated server model with disconnection status
     */
    disconnect(serverModel: McpServerModel): Promise<McpServerModel>;
    /**
     * Reconnect to an MCP server
     * @param serverModel The server model to reconnect to
     * @returns Updated server model with reconnection status
     */
    reconnect(serverModel: McpServerModel): Promise<McpServerModel>;
}
