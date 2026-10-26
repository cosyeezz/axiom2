/**
 * Proxy utility class for handling proxy configuration and no_proxy rules
 */
export declare abstract class ProxyUtils {
    /**
     * 安全地禁用 TLS 证书验证。
     * TLS warning 的抑制在 shim.ts 中通过 process.emitWarning 拦截器统一处理。
     */
    static disableTlsVerification(): void;
    /**
     * Resolve the absolute target URL of an axios request from its `url` and `baseURL`.
     * Mirrors axios' built-in URL combination so that proxy / no_proxy decisions are
     * made against the real outbound URL rather than partial fragments.
     *
     * - If `url` is already absolute, return it as-is.
     * - If `baseURL` is provided, join them with axios' rules.
     * - Otherwise fall back to whichever piece is available.
     */
    static resolveRequestUrl(url?: string, baseURL?: string): string;
    /**
     * Check if target host should bypass proxy based on no_proxy environment variable
     * @param targetUrl Target URL to check
     * @returns true if should bypass proxy, false otherwise
     */
    static shouldBypassProxy(targetUrl: string): boolean;
    /**
     * Get proxy URL from environment variables
     * @returns Proxy URL string or undefined if not set
     */
    static getProxyUrl(): string | undefined;
    /**
     * Check if proxy should be used for given URL
     * @param targetUrl Target URL to check
     * @returns true if proxy should be used, false otherwise
     */
    static shouldUseProxy(targetUrl: string): boolean;
}
