export declare const HOOK_SERVICE_PROXY_PATH = "/internal/hooks/services/invoke";
/** A capability owned by one standalone ConfigChange hook operation. */
export interface HookServiceCapability {
    createProxyUrl(endpoint: string): string;
    resolveInvocationPath(requestPath: string): string | undefined;
}
export declare class HookServiceCapabilityImpl implements HookServiceCapability {
    private readonly token;
    createProxyUrl(endpoint: string): string;
    resolveInvocationPath(requestPath: string): string | undefined;
    private matches;
}
