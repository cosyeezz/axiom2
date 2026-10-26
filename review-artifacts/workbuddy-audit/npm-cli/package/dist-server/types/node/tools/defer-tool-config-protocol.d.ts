import { McpConfig } from '../mcp/mcp-protocol';
import type { ToolDeferOverlay } from './tool-spec';
export declare const DeferToolConfigService: unique symbol;
/**
 * Maximum number of deferred tools to display with full description.
 * Tools beyond this limit will only show their names.
 * @deprecated Kept for shouldShowAllTools compatibility. Use DEFAULT_DEFERRED_TOOLS_CHAR_BUDGET instead.
 */
export declare const DEFAULT_MAX_TOOLS_WITH_DESCRIPTION = 50;
/**
 * Character budget for the deferred tools description block.
 * Controls the total size of the formatted tool list injected into the system prompt.
 * Overridable via environment variable CODEBUDDY_DEFERRED_TOOLS_CHAR_BUDGET.
 *
 * ~20000 chars ≈ ~5000 tokens — enough for ~15 MCP servers with ~10 tools each.
 */
export declare const DEFAULT_DEFERRED_TOOLS_CHAR_BUDGET = 20000;
/**
 * Maximum characters for a single MCP server description in the group header.
 * Descriptions longer than this are truncated with "…".
 */
export declare const MCP_SERVER_DESC_MAX_CHARS = 100;
/**
 * Service for managing deferred tool loading configuration.
 *
 * Configuration priority (highest to lowest):
 * 0. Claude-compatible server `alwaysLoad: true` hard guarantee
 * 1. Session-scoped overlay (Defer(...) / NoDefer(...) modifiers from --tools / agent frontmatter)
 * 2. Tool-level MCP config (tools[name].defer_loading)
 * 3. Server-level MCP config (defer_loading)
 * 4. Environment variable (CODEBUDDY_DEFER_TOOL_LOADING)
 * 5. Settings (deferToolLoading)
 * 6. Product default (true)
 *
 * Within the overlay, `NoDefer(...)` wins over `Defer(...)` — explicit opt-out
 * is the strongest user intent.
 */
export interface DeferToolConfigService {
    /**
     * Check if global defer loading is enabled.
     * Respects configuration priority: env var > settings > product default.
     */
    isGlobalDeferLoadingEnabled(): Promise<boolean>;
    /**
     * Check if the deferred-tools prompt listing should bypass the character budget.
     * When enabled, all server groups are included, but per-tool formatting stays unchanged.
     * Configurable via environment variable CODEBUDDY_SHOW_ALL_DEFERRED_TOOLS.
     */
    shouldShowAllTools(): boolean;
    /**
     * Calculate effective defer loading status for an MCP tool.
     *
     * Backward-compatible shim: equivalent to {@link isToolDeferLoadingWithOverlay}
     * with `overlay = undefined`.
     *
     * @param config MCP server configuration
     * @param toolNames Tool name candidates in priority order (e.g. rawToolName, original tool.name)
     */
    isToolDeferLoading(config: McpConfig, ...toolNames: string[]): Promise<boolean>;
    /**
     * Overlay-aware version of {@link isToolDeferLoading}. The first toolName
     * matched by the overlay wins (force-no-defer beats force-defer beats all
     * other sources except the server-wide `alwaysLoad` hard guarantee).
     *
     * @param overlay  Session-scoped overlay; `undefined` falls back to the legacy path.
     * @param config   MCP server configuration.
     * @param toolNames Tool name candidates in priority order.
     */
    isToolDeferLoadingWithOverlay(overlay: ToolDeferOverlay | undefined, config: McpConfig, ...toolNames: string[]): Promise<boolean>;
    /**
     * Effective defer status for a *builtin* (non-MCP) tool.
     *
     * Priority:
     * 1. Session overlay (NoDefer wins over Defer).
     * 2. Product default (i.e. `Tool.defer_loading` populated from
     *    `product.tools[].deferLoading` by ToolManager).
     *
     * The global `isGlobalDeferLoadingEnabled` switch is *not* consulted here —
     * callers (agent-manager.createIsEnabledChecker) gate on it separately so
     * that a single global "off" toggle continues to disable the entire
     * deferred-loading machinery without forcing every callsite to query both.
     *
     * @param toolName        Tool name (e.g. `Read`, `Glob`).
     * @param productDefault  Static defer flag from product config.
     * @param overlay         Session-scoped overlay; `undefined` is treated as EMPTY.
     */
    isBuiltinToolDeferLoading(toolName: string, productDefault: boolean, overlay: ToolDeferOverlay | undefined): boolean;
}
