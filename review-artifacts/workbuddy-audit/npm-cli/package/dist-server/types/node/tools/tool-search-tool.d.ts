import type { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { DeferToolConfigService } from './defer-tool-config-protocol';
import { Tool, ToolCallArgumentRenderer, ToolManager, ToolResult } from './tool-protocol';
import { ToolSearchService } from './tool-search-protocol';
import { AgentToolDeferOverlayCache } from './tool-spec';
/**
 * Parameters for the tool_search tool
 */
declare const ToolSearchParameters: z.ZodObject<{
    queries: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], unknown>>;
    tool_names: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], unknown>>;
    top_k: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    top_k: number;
    queries?: string[] | undefined;
    tool_names?: string[] | undefined;
}, {
    queries?: unknown;
    tool_names?: unknown;
    top_k?: number | undefined;
}>;
/**
 * Tool for searching deferred tools and returning their metadata (name, description, parameter schema).
 *
 * Supports two operations via separate parameters:
 * - "queries": Search by keywords, return top_k results with full details, show remaining as candidates.
 * - "tool_names": Look up tools by exact name(s), with fuzzy search fallback.
 *
 * Tools found by ToolSearch are NOT injected into the LLM tools list.
 * Instead, the model should use DeferExecuteTool to invoke them, passing the
 * tool name and parameters learned from the schema returned here.
 */
export declare class ToolSearchTool extends BaseTool implements Tool {
    protected readonly toolSearchService: ToolSearchService;
    protected readonly deferToolConfigService: DeferToolConfigService;
    protected readonly toolManager: ToolManager;
    protected readonly agentToolDeferOverlayCache: AgentToolDeferOverlayCache;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    readonly promptCacheStability: "volatile";
    isEnabled: () => Promise<boolean>;
    parameters: z.ZodObject<{
        queries: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], unknown>>;
        tool_names: z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], unknown>>;
        top_k: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        top_k: number;
        queries?: string[] | undefined;
        tool_names?: string[] | undefined;
    }, {
        queries?: unknown;
        tool_names?: unknown;
        top_k?: number | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * Tool search does not need user approval
     */
    needsApproval: boolean;
    execute(input: z.infer<typeof ToolSearchParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * Search mode: search by keywords, return top_k with full schema, show remaining as candidates.
     */
    private executeSearchMode;
    /**
     * Lookup mode: look up tools by exact name(s).
     * Falls back to search(name, 1) when exact match is not found.
     */
    private executeLookupMode;
    /**
     * Format search mode results with primary tools (including schema) and optional candidates.
     */
    private formatSearchResults;
    /**
     * Format lookup mode results with full tool info.
     */
    private formatLookupResults;
    /**
     * 会话级 `Defer(...)` 命中的内置工具如果未被 product 索引，先懒索引一次。
     *
     * - tool_names 模式：只索引用户显式问到的那些（避免 queries 模式无谓全扫）
     * - queries 模式：把 overlay.forceDefer 精确条目全量索引
     *
     * 通配条目（`Defer(mcp__*)`）不在此处理：
     *   1) MCP 工具的索引由 mcp-manager 异步驱动；
     *   2) 通配反向枚举不出具体工具名。
     */
    private ensureForceDeferIndexed;
    /**
     * Resolve max output chars from environment variable, falling back to default.
     * Read at truncation time so prewarm activation sees the current session env.
     */
    private resolveMaxOutputChars;
    /**
     * Truncate output string to maxOutputChars limit.
     * Appends a truncation notice when content exceeds the limit.
     */
    private truncateOutput;
}
export {};
