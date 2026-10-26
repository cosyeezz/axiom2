import { McpConfigLocation, McpConfigStore, McpData, McpScope } from './mcp-protocol';
export declare class McpConfigStoreImpl implements McpConfigStore {
    /**
     * Caches only the observation that every candidate path for a scope was
     * absent. Existing file contents are always read from disk.
     */
    private readonly negativeReadCache;
    read(scope: McpScope): McpData | undefined;
    readLocalForProject(projectPath: string): McpData | undefined;
    update(scope: McpScope, data: McpData): McpData | undefined;
    delete(scope: McpScope): void;
    isMissing(scope: McpScope): boolean;
    private isNegativeCacheHit;
    invalidate(scope?: McpScope): void;
    getLocation(scope: McpScope): McpConfigLocation;
    private readConfigFileRaw;
    private readConfigFile;
}
