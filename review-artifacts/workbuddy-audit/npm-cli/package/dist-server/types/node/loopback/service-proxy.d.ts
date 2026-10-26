/**
 * The service proxy that hook commands, Bash commands and stdio MCP servers reach
 * through `CODEBUDDY_SERVICE_PROXY_URL`. A CLI process serves it on its loopback
 * endpoint. The library has no loopback endpoint, so a Host that serves the proxy
 * itself supplies its address through `start({ serviceProxy })`.
 */
/** Path of the CLI's service proxy under its loopback endpoint. */
export declare const SERVICE_PROXY_PATH = "/internal/hooks/services/invoke";
export interface ServiceProxyProvider {
    /**
     * The address a process gets as `CODEBUDDY_SERVICE_PROXY_URL`, asked each time
     * one starts. Callers append the service path and send `X-Service-Id`, as with
     * the CLI's own endpoint. `undefined` leaves the variable to the loopback endpoint.
     */
    resolve(): Promise<string | undefined>;
}
/** Set by `start()` and cleared when the runtime stops. */
export declare function registerHostServiceProxy(provider: ServiceProxyProvider | undefined): void;
/**
 * The address a process gets: the Host's when it supplies one, otherwise the
 * loopback endpoint's. Rejects when neither is available.
 */
export declare function resolveServiceProxyUrl(endpoint: {
    get(): Promise<string>;
}): Promise<string>;
