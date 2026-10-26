import { McpConfigHTTP, McpConfigSSE, McpOAuthInfo, McpOAuthStore, McpOAuthStoreData, McpOAuthStoreResult, OAuthClientInformation, OAuthTokens } from './mcp-protocol';
/**
 * Implementation of McpOauthStore that manages OAuth credentials storage
 * Based on the reference implementation from claude-code
 */
export declare class McpOauthStoreImpl implements McpOAuthStore {
    private mcpLogService;
    private consoleManager;
    private readonly storageDir;
    private readonly storagePath;
    constructor();
    /**
     * Generate a unique key for MCP OAuth tokens based on server config
     */
    private generateServerKey;
    snapshotCredentialPresence(): {
        hasCredentials(serverName: string, config: import('./mcp-protocol').McpConfig): boolean;
    };
    read(): McpOAuthStoreData | null;
    update(data: McpOAuthStoreData): McpOAuthStoreResult;
    delete(serverName: string): void;
    clear(): boolean;
    saveTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP, tokens: OAuthTokens): McpOAuthStoreResult;
    loadTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP): OAuthTokens | undefined;
    deleteMcpOAuthTokens(serverName: string, config: McpConfigSSE | McpConfigHTTP): boolean;
    saveMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP, clientInfo: OAuthClientInformation, clientMetadataVersion?: number): McpOAuthStoreResult;
    loadMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP, expectedClientMetadataVersion?: number): OAuthClientInformation | undefined;
    deleteMcpClientInfo(serverName: string, config: McpConfigSSE | McpConfigHTTP): boolean;
    areTokensExpired(tokens: McpOAuthInfo | null, bufferSeconds?: number): boolean;
}
