import { ConsoleManager } from '../console';
import { McpManager, McpOAuthManager } from './mcp-protocol';
export interface OAuthCallbackQuery {
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
}
export declare class McpOAuthController {
    protected readonly oauthManager: McpOAuthManager;
    protected readonly mcpManager: McpManager;
    protected readonly consoleManager: ConsoleManager;
    /**
     * Handle OAuth callback from authorization server
     * It will attempt to find the server by matching the OAuth state parameter
     */
    handleCallback(query: OAuthCallbackQuery): Promise<string>;
    protected applyOAuthCallbackSecurityHeaders(): void;
    protected processOAuthCallback(query: OAuthCallbackQuery): Promise<string>;
}
/**
 * Legacy controller for backward compatibility with /internal/mcp/oauth/callback path
 */
export declare class McpOAuthInternalController extends McpOAuthController {
    handleCallback(query: OAuthCallbackQuery): Promise<string>;
}
