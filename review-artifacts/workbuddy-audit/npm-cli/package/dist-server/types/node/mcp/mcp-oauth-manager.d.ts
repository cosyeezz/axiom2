import { ConsoleManager } from '../console/console-protocol';
import { EndpointProvider } from '../loopback/server-protocol';
import { McpConfigManager, McpOAuthManager, McpOAuthStore, McpServerModelManager, OAuthCallbackResult, OAuthClientProvider } from './mcp-protocol';
export declare class McpOAuthManagerImpl implements McpOAuthManager {
    protected readonly endpointProvider: EndpointProvider;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly mcpServerModelManager: McpServerModelManager;
    protected readonly mcpOAuthStore: McpOAuthStore;
    protected readonly consoleManager: ConsoleManager;
    private readonly oauthProviders;
    private readonly stateBasedServerModel;
    private readonly oauthStateCache;
    private generatePKCE;
    private isOAuthCompatibleConfig;
    getProvider(name: string): Promise<OAuthClientProvider | undefined>;
    unauthenticate(name: string): Promise<void>;
    /**
     * Handle OAuth callback and exchange code for tokens
     * @param code - OAuth authorization code
     * @param state - OAuth state parameter
     * @param serverName - Optional server name from URL path (preferred method)
     */
    handleOAuthCallback(code: string, state: string): Promise<OAuthCallbackResult>;
    /**
     * Invalidate OAuth credentials for a server
     */
    invalidateCredentials(serverName: string, scope?: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void>;
    /**
     * Get OAuth authorization URL for a server
     */
    getAuthorizationUrl(serverName: string): Promise<string | undefined>;
    private getServerModelByName;
}
