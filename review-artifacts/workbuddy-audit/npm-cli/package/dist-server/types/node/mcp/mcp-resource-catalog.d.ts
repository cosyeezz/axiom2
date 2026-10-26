import { Logger } from '@celljs/core';
import { McpManager } from './mcp-protocol';
import { McpResourceCatalogService, McpResourceDescription, McpResourceListing } from './mcp-resource-catalog-protocol';
/**
 * Default implementation backed by `McpManager.getConnectedServers()`.
 *
 * Mirrors the role of Claude Code's resource discovery layer: aggregate all
 * resources/resource-templates from connected MCP servers so the LLM can list
 * them via `ListMcpResources` and decide what to read. Template instantiation
 * (RFC 6570 placeholder substitution) is intentionally NOT done here — the
 * LLM substitutes `{param}` placeholders itself before passing the URI to
 * `ReadMcpResource`, which keeps this layer minimal and 100% MCP-spec compliant.
 */
export declare class McpResourceCatalogServiceImpl implements McpResourceCatalogService {
    protected readonly mcpManager: McpManager;
    protected readonly logger: Logger;
    /** Last successful listing per server name; see RESOURCE_CACHE_TTL_MS. */
    private readonly listingCache;
    hasResourceCapableServer(): Promise<boolean>;
    listResources(): Promise<McpResourceDescription[]>;
    listResourcesDetailed(): Promise<McpResourceListing>;
    /**
     * Per-server listing with a short success cache and a failure fallback.
     *
     * Never rejects: aggregation must survive one bad server.
     */
    private loadServerListing;
    /** Drop cache entries for servers that are no longer connected. */
    private pruneDisconnectedServers;
    private safeListResources;
    private safeListResourceTemplates;
}
