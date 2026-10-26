import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { z } from 'zod';
import { McpManager } from '../mcp/mcp-protocol';
import { McpResourceCatalogService } from '../mcp/mcp-resource-catalog-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const ReadMcpResourceParameters: z.ZodObject<{
    server: z.ZodString;
    uri: z.ZodString;
}, "strip", z.ZodTypeAny, {
    uri: string;
    server: string;
}, {
    uri: string;
    server: string;
}>;
type ReadMcpResourceInput = z.infer<typeof ReadMcpResourceParameters>;
/**
 * ReadMcpResource — read a single resource from a connected MCP server.
 *
 * Pairs with `ListMcpResources`. Mirrors the original `FetchMcpResource`
 * read path; resource catalog is no longer baked into the description (use
 * `ListMcpResources` to discover resources first). Issue #40458.
 */
export declare class ReadMcpResourceTool extends BaseTool implements Tool {
    protected readonly mcpManager: McpManager;
    protected readonly catalogService: McpResourceCatalogService;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    parameters: z.ZodObject<{
        server: z.ZodString;
        uri: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        uri: string;
        server: string;
    }, {
        uri: string;
        server: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /** Read-only — no approval needed. */
    needsApproval: boolean;
    /**
     * Enable the tool when a connected server declares the `resources`
     * capability. Gating on a live listing instead made this tool vanish
     * mid-session whenever one slow server timed out — see the longer note on
     * `ListMcpResourcesTool.isEnabled` (issue #102572).
     */
    isEnabled: () => Promise<boolean>;
    execute(input: ReadMcpResourceInput, _context: RunContext<Session>): Promise<ToolResult>;
    /**
     * Walk the contents array and convert each item into a model-friendly form:
     *  - text items pass through as `{uri, mimeType, text}`
     *  - binary blobs are decoded, written to `<cwd>/.mcp-resources/<random>.<ext>`
     *    and surfaced as `{uri, mimeType, blobSavedTo, text}` where `text` is a
     *    short hint pointing the model to the saved file.
     */
    private persistContents;
    /**
     * Decode a base64 blob and write it to `<cwd>/.mcp-resources/<random>.<ext>`,
     * creating the directory on demand. Returns the absolute file path.
     */
    private persistBlob;
    private errorResult;
}
export { ReadMcpResourceParameters };
export type { ReadMcpResourceInput };
