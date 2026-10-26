import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { z } from 'zod';
import { McpResourceCatalogService } from '../mcp/mcp-resource-catalog-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const ListMcpResourcesParameters: z.ZodObject<{
    server: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    server?: string | undefined;
}, {
    server?: string | undefined;
}>;
type ListMcpResourcesInput = z.infer<typeof ListMcpResourcesParameters>;
/**
 * ListMcpResources — list all resources/templates exposed by connected MCP
 * servers.
 *
 * Pairs with `ReadMcpResource`. The two-tool split (vs. the previous single
 * `FetchMcpResource` that baked the resource catalog into its description)
 * keeps the system prompt small even when an MCP server exposes many
 * resources, and matches the upstream Claude Code naming convention
 * (ListMcpResourcesTool / ReadMcpResourceTool). Issue #40458.
 */
export declare class ListMcpResourcesTool extends BaseTool implements Tool {
    protected readonly catalogService: McpResourceCatalogService;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    parameters: z.ZodObject<{
        server: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        server?: string | undefined;
    }, {
        server?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /** Read-only — no approval needed. */
    needsApproval: boolean;
    /**
     * Enable the tool when a connected server declares the `resources`
     * capability, rather than when a live listing happens to return rows.
     *
     * Issue #102572: the old gate counted actual resources, so an 8s
     * `resources/list` timeout on one slow server (企查查 connector) collapsed
     * the count to zero and removed this tool — and ReadMcpResource with it —
     * from the model's tool list mid-session, restoring it on the next turn.
     * Observed gaps between a successful and a failing listing ranged from
     * milliseconds to four hours, so no cache window can paper over it. The
     * capability is captured during `initialize` and read from memory, so it
     * cannot time out and stays stable for the life of the connection.
     */
    isEnabled: () => Promise<boolean>;
    execute(input: ListMcpResourcesInput, _context: RunContext<Session>): Promise<ToolResult>;
}
export { ListMcpResourcesParameters };
export type { ListMcpResourcesInput };
