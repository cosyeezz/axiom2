import type { FunctionTool, RunContext } from '@openai/agents';
import type { ToolResult } from './tool-protocol';
import type { DeferredToolInfo } from './tool-search-protocol';
/** The existing model snapshot owns this view; no process-wide tool registration. */
export interface RunToolCatalog {
    readonly session: unknown;
    list(): Promise<DeferredToolInfo[]>;
    invoke(name: string, input: unknown, context: RunContext, details: Parameters<FunctionTool['invoke']>[2]): Promise<ToolResult>;
}
/** Metadata from the MCP filter, before the SDK drops it during conversion. */
export type McpDiscoveryRecord = Map<string, {
    summary?: string;
    sensitiveResultPolicy?: string;
}>;
/** Internal presentation metadata; never changes SDK eligibility or invocation. */
export declare function setToolDiscoverySummary(tool: object, summary: string | undefined): void;
export declare function getToolDiscoverySummary(tool: object): string | undefined;
/**
 * The MCP index name of an SDK-converted declaration. ToolSearch lists this
 * name, as the process index does; the SDK function name may differ by
 * toFunctionToolName normalization (for example hyphens become underscores).
 */
export declare function setToolDiscoveryName(tool: object, name: string | undefined): void;
export declare function getToolDiscoveryName(tool: object): string | undefined;
/** Collect from the SDK's actual MCP toolFilter call, before it renames the tool and discards _meta. */
export declare function recordMcpDiscovery(context: unknown, name: string, summary?: unknown, sensitiveResultPolicy?: string): void;
export declare function currentRunToolCatalog(session?: unknown): RunToolCatalog | undefined;
export declare function withRunToolCatalog<T>(catalog: RunToolCatalog, run: () => T): T;
/** Bypass placement only. Availability, mode and permission filters still run. */
export declare function includingDeferredTools(context: RunContext, discovered?: McpDiscoveryRecord): RunContext;
export declare function includesDeferredTools(context: unknown): boolean;
