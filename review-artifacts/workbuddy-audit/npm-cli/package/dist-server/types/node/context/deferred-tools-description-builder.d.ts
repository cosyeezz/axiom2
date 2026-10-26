import { Logger } from '@celljs/core';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentScopedMcpManager, McpConfigManager, McpManager, McpToggleManager } from '../mcp/mcp-protocol';
import { DeferToolConfigService } from '../tools/defer-tool-config-protocol';
import { ToolSearchService } from '../tools/tool-search-protocol';
import { ToolDeferOverlay } from '../tools/tool-spec';
export declare const DeferredToolsDescriptionBuilder: unique symbol;
/**
 * Options for building deferred tools description.
 */
export interface DeferredToolsDescriptionBuildOptions {
    /** Explicit session-view input; omit when building a process-wide cached description. */
    session?: Session;
    /**
     * Filter by agent's tool names. Only show deferred tools that are in this list.
     * MCP tools (starting with "mcp__") are always included regardless of this filter.
     */
    agentToolNames?: string[];
    /**
     * 会话级 defer overlay 的 snapshot。命中 `forceNoDefer` 的工具从描述中剔除
     * （它们已通过 NoDefer 直接进入 LLM 工具列表，无需再经 ToolSearch 发现）。
     * 命中 `forceDefer` 的工具会被一并展示——前提是调用方在调用 build 之前已经
     * 预热过这些工具的索引（详见 tool-manager 的 ToolSearch description 渲染处）。
     */
    overlay?: import('../tools/tool-spec/index.js').ToolDeferOverlaySnapshot | ToolDeferOverlay;
    /**
     * 会话级 `--tools` 白名单（已剥离 Defer/NoDefer 修饰的纯名）。提供后会**叠加**
     * 在 agentToolNames 之上做交集过滤——即工具必须同时出现在 agent 的 tools
     * 配置和 session 白名单里才会展示。MCP 工具不受此过滤约束（与 agentToolNames 同）。
     *
     * 当用户写 `--tools "Bash,Read,Defer(Edit)"` 时，session 白名单是
     * `["Bash","Read","Edit","ToolSearch","DeferExecuteTool"]`（含自动附加），
     * 描述里只会列出实际可达的延迟工具，避免噪音。
     */
    sessionToolNames?: string[];
}
/**
 * Result of building deferred tools description.
 */
export interface DeferredToolsDescriptionResult {
    /** Formatted deferred tools list (includes both builtin and MCP tools, grouped by server) */
    toolSearchDeferredTools?: string;
    /** Total count of deferred tools */
    toolSearchDeferredToolsCount?: number;
    /** Info about omitted tools/servers due to char budget (for template rendering) */
    toolSearchOmittedInfo?: string;
}
/**
 * Service for building deferred tools description for ToolSearch.
 *
 * Display strategy:
 * - Builtin tools: show `name: summary` format (small count, descriptions aid LLM understanding)
 * - MCP tools with mcp__ prefix: grouped by server with server description in group header, tool names only within group
 * - Bare-name MCP tools: rendered in the builtin-style section because their public name has no server prefix
 * - Character budget controls total output size; servers are dropped as whole groups when budget exceeded
 * - The prompt template wraps the returned text in XML tags; this builder returns only the inner list
 */
export interface DeferredToolsDescriptionBuilder {
    build(options?: DeferredToolsDescriptionBuildOptions): Promise<DeferredToolsDescriptionResult>;
}
export declare class DeferredToolsDescriptionBuilderImpl implements DeferredToolsDescriptionBuilder {
    protected readonly toolSearchService: ToolSearchService;
    protected readonly deferToolConfigService: DeferToolConfigService;
    protected readonly mcpConfigManager: McpConfigManager;
    protected readonly mcpToggleManager: McpToggleManager;
    protected readonly logger: Logger;
    protected readonly mcpManager: McpManager;
    protected readonly agentScopedMcpManager: AgentScopedMcpManager;
    build(options?: DeferredToolsDescriptionBuildOptions): Promise<DeferredToolsDescriptionResult>;
    /**
     * Get character budget from env var or default.
     */
    private getCharBudget;
    /**
     * Group tools by server name.
     */
    private groupToolsByServer;
    /**
     * Build structured server groups, separating builtin-style tools from mcp__-prefixed MCP groups.
     * Bare-name MCP tools are intentionally kept in the builtin-style section.
     * Also includes MCP servers that have no indexed tools yet (configured but not connected).
     */
    private buildServerGroups;
    /**
     * Format tool list with character budget enforcement.
     *
     * Strategy:
     * 1. Always include all builtin tools (small count, high value)
     * 2. Add MCP server groups one by one until budget exceeded
     * 3. Remaining servers are omitted with a summary line
     */
    private formatWithBudget;
    /**
     * Format builtin tools section. Each tool gets `name: summary` format.
     */
    private formatBuiltinTools;
    /**
     * Format a single MCP server group.
     * Group header: `mcp__serverName: <truncated description>`
     * Group body: one tool name per line
     */
    private formatServerGroup;
    /**
     * Truncate a description to maxChars, adding "…" if truncated.
     */
    private truncateDescription;
    /**
     * Extract server name from MCP tool name.
     * Format: mcp__serverName__toolName
     */
    private extractServerName;
    /**
     * Collect MCP server names and descriptions from configuration.
     * These are available synchronously from config, independent of async server connections.
     */
    private collectMcpServerInfos;
    /**
     * Snapshot MCP servers whose projected connection has not settled.
     *
     * Aligned with `WaitForMcpServersTool.isEnabled()`: that tool is exposed
     * iff at least one server is PENDING/CONNECTING. We use the same source of truth
     * (`McpManager.list()`) so the hint and the
     * tool come and go together.
     *
     * Errors swallowed: better to render no hint than to fail description build.
     */
    private collectConnectingServerNames;
    /**
     * Snapshot MCP servers currently CONNECTED, used by #90171 to hide the
     * misleading empty group of a connected-but-zero-indexed server (all its
     * tools are defer_loading:false direct and never enter the deferred index).
     * Errors swallowed: better to render the legacy empty group than to fail
     * description build.
     */
    private collectConnectedServerNames;
    private isWaitForMcpServersEnabled;
    /**
     * 求两个工具白名单约束的交集。任一为 undefined 则返回另一个（"未提供该约束" 等价于 "全通过"）。
     * 两者都提供时返回交集；都未提供时返回 undefined。
     *
     * 该函数面向 `ToolSearchService.getDeferredToolsSummary` 的 `filterByAgentTools`
     * 参数——它只对**内置工具**生效，MCP 工具不受过滤约束（service 内部已实现）。
     */
    private intersectFilterSets;
}
