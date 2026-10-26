import { Emitter, Event, Logger } from '@celljs/core';
import { type Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '@openai/agents';
import { type DecisionService as IDecisionService } from '../decision/decision-protocol';
import { AgentScopedMcpManager } from '../mcp/mcp-protocol';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { DeferToolConfigService } from './defer-tool-config-protocol';
import type { ToolInputParameters } from './tool-protocol';
import { DeferredToolInfo, DeferredToolsFilterOptions, DeferredToolSummary, ToolRerankOptions, ToolSearchOptions, ToolSearchResult, ToolSearchService } from './tool-search-protocol';
import type { ToolDeferOverlay } from './tool-spec';
/**
 * ToolSearchService implementation using MiniSearch.
 *
 * MiniSearch provides:
 * - BM25 ranking algorithm (industry standard, better than TF-IDF)
 * - Prefix search support
 * - Zero dependencies
 *
 * @see https://github.com/lucaong/minisearch
 */
export declare class ToolSearchServiceImpl implements ToolSearchService {
    private static readonly DEFAULT_TOP_K;
    private static readonly SEARCH_OPTIONS;
    /** A2 相关性下限（Issue #113176）：相对最高分的默认比例；ABS_MIN 为绝对兜底（0 = 不启用）。 */
    private static readonly DEFAULT_MIN_SCORE_RATIO;
    private static readonly ABS_MIN_SCORE;
    /**
     * 参与精排的候选数上限；超出部分保持召回原序拼在尾部。
     * ToolRet 全量评测选 128：相对 64，recall@3 增加 6.7pp，输入 token 约增加 30%。
     * 完整召回、成本与延迟数据见 docs/agent-cli/toolsearch-rerank-eval.md。
     */
    private static readonly DEFAULT_RERANK_MAX_CANDIDATES;
    /** 单次精排时间预算；ToolSearch 是交互路径，不沿用 Decision 的 30s */
    private static readonly DEFAULT_RERANK_BUDGET_MS;
    /** 限流重试次数：高频路径下多次重试会吃掉预算，宁可本次放弃精排 */
    private static readonly RERANK_RATE_LIMIT_RETRIES;
    /** 连续失败多少次后进入冷却 */
    private static readonly RERANK_BREAKER_THRESHOLD;
    /** 熔断冷却时长；期间直接跳过精排，避免每轮白等预算时间 */
    private static readonly RERANK_BREAKER_COOLDOWN_MS;
    /** 熔断：连续失败计数 */
    private rerankConsecutiveFailures;
    /** 熔断：冷却截止时间戳（0 = 未冷却） */
    private rerankCooldownUntil;
    /** 日志降噪：冷却期内只在进入时告警一次 */
    private rerankCooldownLogged;
    protected readonly logger: Logger;
    protected readonly prewarmState?: IPrewarmStateService;
    protected readonly agentScopedMcpManager: AgentScopedMcpManager;
    protected readonly deferToolConfigService: DeferToolConfigService;
    /** 精排依赖；未注册（如精简装配）时 rerank 静默跳过 */
    protected readonly decisionService?: IDecisionService;
    private miniSearch;
    private deferredTools;
    /**
     * agents-core normalizes model-visible function names. Keep an exact,
     * fail-closed mapping back to the canonical indexed name; `null` denotes
     * a lossy collision between two canonical names.
     */
    private normalizedToolAliases;
    private toolVisibilityChecks;
    /**
     * Per-tool `isEnabled` checks captured at index time, consumed by
     * {@link filterEnabledDeferredTools}. Only builtin deferred tools register a
     * check; MCP tools are absent here and therefore always kept.
     */
    private toolEnabledChecks;
    private initialized;
    private indexInitialized;
    private activationScheduled;
    private scopedToolsSubscription?;
    /**
     * Fires after any mutation to the deferred-tool index. See
     * {@link ToolSearchService.onDidChangeIndex} for why consumers need it.
     */
    protected readonly onDidChangeIndexEmitter: Emitter<void>;
    get onDidChangeIndex(): Event<void>;
    /**
     * Monotonic counter bumped on every index mutation. Consumers that bake a
     * snapshot of the index into a longer-lived structure (e.g. the ToolSearch
     * description frozen into an Agent's tool array at buildTools time) stamp the
     * epoch they built against, then compare later to detect a stale snapshot.
     *
     * `onDidChangeIndex` alone is not enough for those consumers: it only lets
     * them invalidate a *cache*, but an already-frozen Agent instance is not
     * rebuilt by a cache invalidation. The run path uses this epoch to decide
     * whether the resolved agent must be refreshed before the first run.
     */
    private _indexEpoch;
    get indexEpoch(): number;
    /** Bump the epoch and notify subscribers. Single choke point for both. */
    protected fireIndexChanged(): void;
    /**
     * 共享 MiniSearch 配置工厂：init() 与 createSearchIndex() 必须共用，否则进程级全局索引
     * 与 session-scoped 临时索引的分词口径不一致，混合查询会漏召回（方案约束1）。
     * A1 的 camelCase 拆词在此单点接入。
     */
    private static buildMiniSearchOptions;
    protected init(): void;
    protected dispose(): void;
    initialize(): Promise<void>;
    isReady(): boolean;
    private ensureIndexInitialized;
    indexTool(tool: {
        name: string;
        aliases?: string[];
        description: string;
        summary: string;
        parameters: ToolInputParameters;
        defer_loading?: boolean;
        shouldShow?(): boolean;
        isEnabled?(): boolean | Promise<boolean>;
        isBare?: boolean;
        serverName?: string;
        rawToolName?: string;
        annotations?: Record<string, unknown>;
        sensitiveResultPolicy?: string;
    }): Promise<void>;
    search(query: string | string[], topK?: number, options?: ToolSearchOptions): Promise<ToolSearchResult[]>;
    isHiddenByOverlay(toolName: string, overlay: ToolDeferOverlay | undefined): boolean;
    describe(toolName: string): DeferredToolInfo | undefined;
    resolveModelToolName(modelVisibleName: string): string | undefined;
    describeForSession(toolName: string, session?: Session, overlay?: ToolDeferOverlay): Promise<DeferredToolInfo | undefined>;
    isBareTool(toolName: string): boolean;
    getDeferredToolsSummary(options?: DeferredToolsFilterOptions): DeferredToolSummary[];
    listDeferredToolInfos(options?: DeferredToolsFilterOptions): DeferredToolInfo[];
    listDeferredToolInfosForSession(session?: Session, options?: DeferredToolsFilterOptions): Promise<DeferredToolInfo[]>;
    filterEnabledDeferredTools(summaries: DeferredToolSummary[]): Promise<DeferredToolSummary[]>;
    clearIndex(): void;
    removeToolsByServer(serverName: string): void;
    removeTool(name: string): void;
    replaceServerTools(serverName: string, tools: DeferredToolInfo[]): void;
    private collectToolNamesForServer;
    private discardFromSearchIndex;
    getAllowedToolsForAgent(agentName: string | undefined, context: RunContext<Session>): Promise<string[] | undefined>;
    private getAgentAllowedTools;
    private collectEnabledToolNames;
    private getSessionAllowedTools;
    private isToolVisible;
    private resolveGlobalToolInfo;
    private resolveToolInfo;
    private rebuildNormalizedToolAliases;
    private isToolDenied;
    private getVisibleTools;
    private loadScopedTools;
    private toDeferredToolInfo;
    private createSearchIndex;
    /**
     * MCP deferred tools are not listed in agent.tools. Prefix and bare-name MCP
     * entries both bypass agent whitelist filtering; builtin deferred tools must
     * still be explicitly enabled for the agent.
     */
    private isAllowedByAgentTools;
    private doSearch;
    /**
     * Decision 精排。契约见 {@link ToolSearchService.rerank}：**永不抛错**。
     *
     * 分层降级（每层只降级、不失败）：
     * L0 开关默认关 → L1 前置跳过（候选不足 / 超上限截断 / 依赖缺失 / 熔断冷却）
     * → L2 独立超时预算 → L3 全量 catch → L4 响应全有或全无 → L5 熔断 → L6 日志降噪
     */
    rerank(query: string | string[], candidates: ToolSearchResult[], options?: ToolRerankOptions): Promise<ToolSearchResult[]>;
    /** 多 query 合并为一段任务描述；Decision 的 input 只接受文本 */
    private buildRerankInput;
    /**
     * 校验并抽取逐候选概率。任一不满足返回 undefined（触发整体放弃）：
     * 答案数量不等于问题数、类型非 predicate、概率不是 [0,1] 内的有限数。
     */
    private extractRerankProbabilities;
    /** 精排是否启用；默认关，需显式 true/1 */
    private isRerankEnabled;
    /** 熔断：冷却期内跳过精排，避免 API 持续不可用时每轮白等预算时间 */
    private isRerankCoolingDown;
    /** 记一次失败；达阈值则进入冷却。日志按失败类归并，不逐次刷屏 */
    private noteRerankFailure;
    /** 读取正整数 env 覆盖；非法或缺省回落默认值 */
    private resolvePositiveIntEnv;
    /**
     * A2 相关性下限：丢弃分数低于 `top1 * ratio` 或绝对下限的结果。
     * `results` 必须已按分数降序（doSearch 输出即降序，后续 filter 保持顺序）。
     * `ratio <= 0` 时完全跳过（含绝对下限），供 lookup 模糊兜底"总给最接近的一个"。
     */
    private applyRelevanceFloor;
    /** 运行时解析 env 相对阈值；非法或缺省回落到 {@link DEFAULT_MIN_SCORE_RATIO}。 */
    private resolveMinScoreRatio;
}
