/** Host adapters supply catalog data and short-lived locations, never installation state. */
export interface MarketplaceProviderCatalog {
    name: string;
    description?: string;
    metadata?: Record<string, unknown>;
    plugins: Array<{
        name: string;
        version: string;
        description?: string;
        dependencies?: Array<string | {
            name: string;
            version?: string;
            marketplace?: string;
        }>;
        source: {
            type: 'archive';
            sha256: string;
        };
    }>;
}
export interface MarketplaceProvider {
    /** Stable marketplace name; the returned catalog must use the same name. */
    readonly name: string;
    readCatalog(options: {
        signal: AbortSignal;
        /** Last committed metadata, available even when the remote catalog is offline. */
        previousMetadata?: Record<string, unknown>;
    }): Promise<MarketplaceProviderCatalog>;
    resolveArchive(options: {
        name: string;
        version: string;
        sha256: string;
        signal: AbortSignal;
    }): Promise<{
        url: string;
    }>;
    /** Optional host proxy/PAC policy. Harness still validates and downloads every redirect. */
    resolveProxyForUrl?(url: string): Promise<string | undefined>;
}
export type MarketplaceProviders = Readonly<Record<string, MarketplaceProvider>>;
//# sourceMappingURL=marketplace-provider-types.d.ts.map