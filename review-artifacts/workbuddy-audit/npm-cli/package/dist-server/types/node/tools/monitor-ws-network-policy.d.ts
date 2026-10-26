import type { SandboxCenterClient } from '@genie/sandbox-cli/sandbox-center-client';
export type WsPolicyResult = {
    allowed: true;
    action?: 'allow' | 'ask';
} | {
    allowed: false;
    reason: string;
};
/**
 * URL 静态校验：只允许 ws/wss、ASCII、无空白和无内嵌凭据。
 */
export declare function validateWsUrl(rawUrl: string): WsPolicyResult;
/** `ws.protocols` 校验：合法 subprotocol token、无重复。 */
export declare function validateWsProtocols(protocols?: string[]): WsPolicyResult;
/**
 * 连接前校验：静态 URL → SSRF → Center 域名策略 → protocols。
 *
 * SSRF 必须先于 Center allow 规则，避免 allow 规则成为内网访问绕过口。
 */
export declare function checkWsNetworkPolicy(rawUrl: string, protocols: string[] | undefined, sandboxCenterClient?: SandboxCenterClient, sessionId?: string): Promise<WsPolicyResult>;
