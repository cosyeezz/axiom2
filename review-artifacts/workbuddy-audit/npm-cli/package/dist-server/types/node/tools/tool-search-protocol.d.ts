import type { Event } from '@celljs/core';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '@openai/agents';
import type { ToolInputParameters } from './tool-protocol';
import type { ToolDeferOverlay } from './tool-spec';
export declare const ToolSearchService: unique symbol;
/**
 * Result from tool search operation
 */
export interface ToolSearchResult {
    /** Tool name */
    name: string;
    /** Tool description */
    description: string;
    /** Similarity score (0-1, higher is better) */
    score: number;
}
/**
 * Full tool information for deferred tools
 */
export interface DeferredToolInfo {
    /** Tool name */
    name: string;
    /** Builtin permission aliases, retained when the tool is deferred. */
    aliases?: string[];
    /** Full tool description (rendered from product config template) */
    description: string;
    /** Short summary for ToolSearch prompt listing (one-liner from tool class) */
    summary: string;
    /** Tool input schema */
    parameters: ToolInputParameters;
    /** Whether this MCP tool is indexed with a bare name (no mcp__ prefix). */
    isBare?: boolean;
    /** MCP server that provides this tool. Undefined for builtin deferred tools. */
    serverName?: string;
    /** Raw MCP tool name as listed by the server. Undefined for builtin deferred tools. */
    rawToolName?: string;
    /** Untrusted MCP behavior hints retained as Reviewer evidence. */
    annotations?: Record<string, unknown>;
    /**
     * 工具结果的敏感内容处理策略（来自 MCP _meta.sensitiveResultPolicy）。
     * 仅信任 builtin_tools 声明的值。设为 'automatic-protection' 时，
     * 敏感准入层跳过弹窗直接走静默加密路径。
     */
    sensitiveResultPolicy?: string;
}
/**
 * Summary of a deferred tool (for system prompt hints)
 */
export interface DeferredToolSummary {
    /** Tool name */
    name: string;
    /** Short summary for display in ToolSearch prompt hint */
    summary: string;
}
/**
 * Options for filtering deferred tools summary
 */
export interface DeferredToolsFilterOptions {
    /**
     * Filter by agent's tool names. Only show builtin deferred tools that are in this list.
     * MCP tools, including mcp__-prefixed and indexed bare-name MCP tools, are always included.
     */
    filterByAgentTools?: string[];
    /**
     * 会话级 defer overlay。命中 forceNoDefer 的工具将被静默剔除——它们已通过
     * NoDefer(...) 暴露在 LLM tools list 里，不应再在 deferred-tools 提示中重复
     * 出现，否则模型会困惑「应该直接调还是走 DeferExecuteTool 调」。
     */
    overlay?: ToolDeferOverlay;
}
/**
 * Options for tool search
 */
export interface ToolSearchOptions {
    /**
     * Filter search results by allowed tool names.
     * Builtin deferred tools must be in this list; MCP tools, including mcp__-prefixed
     * and indexed bare-name MCP tools, are always included regardless of this filter.
     */
    allowedTools?: string[];
    /**
     * 会话级 defer overlay。命中 forceNoDefer 的工具会从搜索/lookup 结果中剔除
     * （静默——ToolSearch 是探索性 API，搜不到等同于不存在，不报错）。
     */
    overlay?: ToolDeferOverlay;
    /** 当前 session，用于加入 subagent scoped MCP tools。 */
    session?: Session;
    /**
     * A2 相关性下限（Issue #113176）：相对最高分的比例（0–1）。低于 `top1 * ratio`
     * 的结果被丢弃。缺省用服务级默认（env `CODEBUDDY_TOOL_SEARCH_MIN_SCORE_RATIO`，否则 0.3）。
     * 传 `0` 完全关闭阈值——lookup 的模糊兜底 `search(name, 1)` 用它保证"总能给最接近的一个"。
     */
    minScoreRatio?: number;
}
/** {@link ToolSearchService.rerank} 的可选项 */
export interface ToolRerankOptions {
    /** 当前 session，用于 Decision 请求的会话归因（计费归户 / 审计 / 埋点） */
    session?: Session;
    /** 时间预算（ms）。超时即放弃精排、回落入参顺序。缺省见服务实现 */
    budgetMs?: number;
    /** 外部取消信号；触发时放弃精排 */
    abortSignal?: AbortSignal;
}
/**
 * Service for searching and managing deferred tools.
 * Uses MiniSearch for full-text search with BM25 ranking.
 */
export interface ToolSearchService {
    /**
     * Initialize the service.
     * Should be called during application startup.
     */
    initialize(): Promise<void>;
    /**
     * Check if the service is ready for use.
     */
    isReady(): boolean;
    /**
     * Index a tool for later search.
     * Only tools with defer_loading: true should be indexed.
     *
     * @param tool Tool definition to index
     */
    indexTool(tool: {
        name: string;
        aliases?: string[];
        /** Full tool description for search matching and ToolSearch results */
        description: string;
        /** Short one-line summary for ToolSearch prompt listing */
        summary: string;
        parameters: ToolInputParameters;
        defer_loading?: boolean;
        /** Optional callback to dynamically control tool visibility in search results and system prompt. */
        shouldShow?(): boolean;
        /**
         * Optional callback reporting whether this deferred tool is currently
         * enabled (mirrors {@link Tool.isEnabled}, evaluated without a session).
         * When present and it resolves false, the tool is dropped from the
         * `<available_deferred_tools>` system-prompt hint so the prompt stays in
         * sync with what ToolSearch / DeferExecuteTool will actually allow.
         */
        isEnabled?(): boolean | Promise<boolean>;
        /** Whether this tool uses a bare name (no mcp__ prefix). Bare-name tools bypass agent whitelist filtering. */
        isBare?: boolean;
        /** MCP server that provides this tool. Undefined for builtin deferred tools. */
        serverName?: string;
        /** Raw MCP tool name as listed by the server. Undefined for builtin deferred tools. */
        rawToolName?: string;
        /** Untrusted MCP behavior hints retained as Reviewer evidence. */
        annotations?: Record<string, unknown>;
        /** Sensitive result policy from MCP _meta (trusted builtin_tools only). */
        sensitiveResultPolicy?: string;
    }): Promise<void>;
    /**
     * Search for tools matching the query.
     * Supports prefix matching and fuzzy search for typo tolerance.
     *
     * @param query Search query - can be a string or array of keywords
     * @param topK Maximum number of results to return (default: 5)
     * @param options Optional search options for filtering results
     * @returns Array of matching tools sorted by relevance
     */
    search(query: string | string[], topK?: number, options?: ToolSearchOptions): Promise<ToolSearchResult[]>;
    /**
     * 用 Decision 判断模型对召回候选做精排（二阶段检索的第二阶段）。
     *
     * 由调用方在**自己的过滤完成之后、截断之前**显式调用——`search()` 的调用方
     * 普遍传 `topK = Infinity` 再自行过滤（MCP 白名单 / codeMode / repl_expose），
     * 若把精排塞进 `search()` 内部，排的是过滤前的集合，既多付成本、排序又会被
     * 后续过滤打乱。lookup 的模糊兜底路径不应调用本方法。
     *
     * **永不抛错**：未启用、候选不足、超预算、API 失败、响应不可用——一律原样
     * 返回 `candidates`（保持入参顺序），最差等于没精排。
     *
     * @param query 与 `search()` 同源的查询
     * @param candidates 已过滤的候选，需按召回相关性降序
     * @returns 精排后的结果；失败时为入参本身
     */
    rerank(query: string | string[], candidates: ToolSearchResult[], options?: ToolRerankOptions): Promise<ToolSearchResult[]>;
    /**
     * Get full information about a tool by name.
     *
     * @param toolName The tool name to look up
     * @returns Tool info if found, undefined otherwise
     */
    describe(toolName: string): DeferredToolInfo | undefined;
    /**
     * Resolve an agents-core model-visible function name to one canonical
     * indexed name. Returns undefined when normalization is ambiguous.
     */
    resolveModelToolName(modelVisibleName: string): string | undefined;
    /** Get full information about a global or session-scoped deferred tool. */
    describeForSession(toolName: string, session?: Session, overlay?: ToolDeferOverlay): Promise<DeferredToolInfo | undefined>;
    /**
     * Return true when the indexed tool is a bare-name MCP tool.
     */
    isBareTool(toolName: string): boolean;
    /**
     * 判断某工具是否被会话级 overlay 强制设为非 defer（即用户写了 `NoDefer(X)`）。
     * 命中时该工具应该从 ToolSearch / DeferExecuteTool 的视野中剔除，由
     * agent-manager / mcp-server-manager 路径让它正常出现在 LLM tools list。
     *
     * overlay 为 undefined 或 EMPTY 时一律返回 false。
     */
    isHiddenByOverlay(toolName: string, overlay: ToolDeferOverlay | undefined): boolean;
    /**
     * Get summaries of all indexed deferred tools.
     * Used for injecting hints into the system prompt.
     *
     * @param options Optional filter options
     * @returns Array of tool summaries
     */
    getDeferredToolsSummary(options?: DeferredToolsFilterOptions): DeferredToolSummary[];
    /**
     * Given a set of deferred-tool summaries, drop the builtin ones whose
     * {@link indexTool} `isEnabled` check currently resolves false.
     *
     * This closes the gap between {@link getDeferredToolsSummary} (which lists
     * a tool purely from the agent's static tools config) and the actual
     * ToolSearch / DeferExecuteTool gating (which runs `isEnabled`). Without it,
     * a product variant that disables a feature (e.g. `productFeatures.ImageGen
     * = false`) would still advertise the tool in `<available_deferred_tools>`,
     * leading the model to call a tool that is then rejected as "not available".
     *
     * MCP tools (no registered `isEnabled` check) and any tool whose check
     * throws are kept (fail-open), matching the ToolSearch gating semantics.
     * Evaluated without a session — safe because builtin deferred tools' checks
     * do not read the run context.
     */
    filterEnabledDeferredTools(summaries: DeferredToolSummary[]): Promise<DeferredToolSummary[]>;
    /**
     * Same visibility semantics as {@link getDeferredToolsSummary} (isToolVisible +
     * overlay + agent-tool filtering), but returns the **full** {@link DeferredToolInfo}
     * instead of the two-field summary.
     *
     * Needed by consumers that must render parameter shapes — most notably the REPL
     * skeleton catalog, which needs `parameters` to derive a one-line parameter
     * skeleton. `getDeferredToolsSummary` omits `parameters`, and
     * `describeForSession` only resolves one tool per call (N awaits for N tools).
     *
     * @param options Optional filter options
     */
    listDeferredToolInfos(options?: DeferredToolsFilterOptions): DeferredToolInfo[];
    /** Includes the current session's MCP tools without populating a second index. */
    listDeferredToolInfosForSession(session?: Session, options?: DeferredToolsFilterOptions): Promise<DeferredToolInfo[]>;
    /**
     * Clear all indexed tools.
     * Useful for resetting the service.
     */
    clearIndex(): void;
    /** Remove a retired dynamically registered tool without clearing unrelated providers. */
    removeTool(name: string): void;
    /**
     * Remove all tools indexed for a specific MCP server.
     * Used when an MCP server reports tools/list_changed to clear stale tools.
     *
     * @param serverName The MCP server name (tools are prefixed with mcp__{serverName}__)
     */
    removeToolsByServer(serverName: string): void;
    /**
     * Atomically replace every indexed tool of one MCP server.
     *
     * Callers must resolve the whole group first and commit it in one call.
     * Indexing tool-by-tool via {@link indexTool} publishes each partial state
     * to readers: every write bumps the index epoch, and that epoch is what
     * makes the run path re-bake an agent's tool list — so the re-bake lands
     * mid-write and renders a ToolSearch description missing the tools that
     * were not stored yet (issue #95034).
     *
     * The implementation must stay synchronous. On a single-threaded runtime a
     * synchronous function cannot yield, which is what makes the swap atomic
     * without any locking.
     *
     * @param serverName MCP server owning the group
     * @param tools Complete replacement set; an empty array clears the group
     */
    replaceServerTools(serverName: string, tools: DeferredToolInfo[]): void;
    /**
     * Get allowed built-in tool names for the specified agent and session.
     *
     * Uses the AgentManager wrapped isEnabled chain, including defer activation bypass,
     * original tool availability, SDK tools/disallowedTools, delegate-mode and visibility checks.
     * Then intersects it with the current session-level `--tools` whitelist when present.
     * Whole-tool denies also hide declarations. Argument-scoped denies and ask rules
     * remain execution-time checks in ToolPermissionService.
     *
     * @param agentName The agent name to look up
     * @param context The current run context (passed to isEnabled checks)
     * @returns Array of allowed tool names, or undefined if no filtering should be applied
     */
    getAllowedToolsForAgent(agentName: string | undefined, context: RunContext<Session>): Promise<string[] | undefined>;
    /**
     * Fires whenever the deferred-tool index mutates (a tool is indexed, discarded,
     * removed by server, or the whole index is cleared).
     *
     * Consumers that cache anything derived from the index — most importantly the
     * rendered `ToolSearch` tool description — subscribe to this to invalidate their
     * cache. MCP servers connect and index their deferred tools asynchronously after
     * startup, and nothing else in the config/agent fingerprint reflects that change,
     * so without this signal a description cached before the MCP tools were indexed
     * would be reused for the first prompt (missing e.g. `mcp__wb-issues__*`).
     */
    readonly onDidChangeIndex: Event<void>;
    /**
     * Monotonically increasing counter, bumped on every index mutation (same
     * moments {@link onDidChangeIndex} fires).
     *
     * `onDidChangeIndex` lets a consumer invalidate a *cache*, but it does not
     * rebuild structures that already froze a snapshot of the index — e.g. the
     * ToolSearch description baked into an `Agent`'s tool array at buildTools
     * time. Such consumers stamp the epoch they built against and compare later
     * to detect staleness (the run path uses this to refresh a stale agent
     * before the first run, without blocking `initialize` / `get_available_models`).
     */
    readonly indexEpoch: number;
}
