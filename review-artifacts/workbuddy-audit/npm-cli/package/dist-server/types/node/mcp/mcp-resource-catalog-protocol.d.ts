import { McpResource, McpResourceTemplate } from './mcp-protocol';
/**
 * Aggregated description of a single MCP resource or resource template,
 * suitable for embedding in a tool description visible to the LLM.
 */
export interface McpResourceDescription {
    /** MCP server name */
    serverName: string;
    /** Resource URI or template URI */
    uri: string;
    /** Human-readable name */
    name: string;
    /** Optional description of the resource */
    description?: string;
    /** Optional MIME type */
    mimeType?: string;
    /** True when the URI is a template containing `{param}` placeholders */
    isTemplate: boolean;
}
export declare const McpResourceCatalogService: unique symbol;
/**
 * Service that aggregates MCP resources/resource templates from all connected
 * MCP servers.
 *
 * This is what makes resources visible to the LLM (via the ListMcpResources
 * tool) and lets ReadMcpResource gate its `isEnabled` on whether any
 * resources actually exist. The LLM is expected to substitute template
 * placeholders (`{param}`) itself before calling ReadMcpResource — mirrors
 * Claude Code's design and avoids re-implementing RFC 6570 server-side.
 */
export interface McpResourceCatalogService {
    /**
     * List all resources and resource templates from currently connected MCP
     * servers, flattened into a single array suitable for prompt rendering.
     */
    listResources(): Promise<McpResourceDescription[]>;
    /**
     * Same as {@link listResources}, plus which servers failed to answer.
     *
     * `ListMcpResources` needs the distinction: an empty list from a healthy
     * setup means "nothing is published", while an empty list caused by a
     * timeout means "we could not ask". Reporting both as `count: 0` lets the
     * model conclude no resources exist and give up (issue #102572).
     */
    listResourcesDetailed(): Promise<McpResourceListing>;
    /**
     * Whether any connected server declared the `resources` capability.
     *
     * Answered purely from the capability set captured during `initialize`, so
     * it cannot time out and does not change while a connection lives. This is
     * the basis for exposing the resource tools: a slow or failing
     * `resources/list` must not make the tools disappear mid-session.
     */
    hasResourceCapableServer(): Promise<boolean>;
}
/** {@link McpResourceCatalogService.listResourcesDetailed} result. */
export interface McpResourceListing {
    resources: McpResourceDescription[];
    /** Servers whose listing failed this round; empty when everything answered. */
    degradedServers: string[];
}
export type { McpResource, McpResourceTemplate };
