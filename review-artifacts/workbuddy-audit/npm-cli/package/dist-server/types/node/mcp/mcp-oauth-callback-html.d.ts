export declare function escapeHtml(s: string): string;
/** CSP for static OAuth callback HTML (inline CSS only, no scripts). */
export declare const OAUTH_CALLBACK_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export declare function generateOAuthSuccessHtml(serverName: string, operation: 'connect' | 'authenticate'): string;
export declare function generateOAuthErrorHtml(errorMessage: string): string;
