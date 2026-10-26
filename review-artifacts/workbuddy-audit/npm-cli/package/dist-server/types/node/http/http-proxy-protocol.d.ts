/** Optional host policy. The HTTP implementation still owns agents and TLS. */
export declare const HttpProxyProvider: unique symbol;
export interface HttpProxyProvider {
    /**
     * Sampled for each HTTP request. No proxyUrl means direct; a rejection is
     * propagated, never replaced with an environment/OS proxy or direct retry.
     * noProxy uses the CLI's existing bypass rules (omitted: environment rules).
     * environment is the Agent runtime's effective environment, including
     * settings.env. Embedded runtimes may isolate it from the Host process.
     */
    resolve(url: string, environment: Readonly<NodeJS.ProcessEnv>): HttpProxyResolution | Promise<HttpProxyResolution>;
}
export interface HttpProxyResolution {
    readonly proxyUrl?: string;
    readonly noProxy?: string;
}
