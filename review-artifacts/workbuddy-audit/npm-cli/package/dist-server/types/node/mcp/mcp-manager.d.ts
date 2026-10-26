import { Logger } from '@celljs/core';
import { EventService } from '@genie/telemetry';
import { Subject } from 'rxjs';
import { ConsoleManager } from '../console';
import { DebugService } from '../debug';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { StartupProfiler } from '../telemetry';
import { DeferToolConfigService } from '../tools/defer-tool-config-protocol';
import { ToolSearchService } from '../tools/tool-search-protocol';
import { GetPromptResult, McpConfig, McpConfigManager, McpConfigStore, McpConnectionManager, McpDataValue, McpLocation, McpManager, McpOAuthManager, McpPermissionsManager, McpReadyService, McpScope, MCPServer, McpServerManager, McpServerModel, McpServerModelManager, McpToggleManager, McpTool } from './mcp-protocol';
export declare class McpManagerImpl implements McpManager {
    static readonly UNINITIALIZED_SERVERS: McpServerModel[];
    protected readonly configManager: McpConfigManager;
    protected readonly serverManager: McpServerManager;
    protected readonly oauthManager: McpOAuthManager;
    protected readonly logger: Logger;
    protected readonly debugService: DebugService;
    protected readonly consoleManager: ConsoleManager;
    protected readonly serverModelManager: McpServerModelManager;
    protected readonly eventService: EventService;
    protected readonly permissionsManager: McpPermissionsManager;
    protected readonly configStore: McpConfigStore;
    protected readonly connectionManager: McpConnectionManager;
    protected readonly toggleManager: McpToggleManager;
    protected readonly startupProfiler: StartupProfiler;
    protected readonly toolSearchService: ToolSearchService;
    protected readonly deferToolConfigService: DeferToolConfigService;
    protected readonly mcpReadyService: McpReadyService;
    protected readonly sandboxLifecycle?: ISandboxCLILifecycle;
    readonly serverCollectionSubject: Subject<McpServerModel[]>;
    readonly oauthCompletionSubject: Subject<{
        serverName: string;
        success: boolean;
        error?: string;
    }>;
    private allServersCache;
    private allServersCacheInitialized;
    /**
     * Monotonic desired-state revision. Every config mutation advances it,
     * including mutations that arrive while a scan is already running.
     *
     * `projectedRevision` only advances after the corresponding effective
     * config snapshot has been atomically projected into `allServersCache`.
     * This replaces the old "one inflight promise" dedupe, which could swallow
     * a mutation that arrived during that promise and strand readiness forever.
     */
    private desiredRevision;
    private projectedRevision;
    private queuedRevision;
    private reconcileTail;
    /**
     * Identity of the currently projected runtime slot for each effective
     * server name. A slot identity is retained across no-op scans and replaced
     * only when its effective scope/config changes.
     *
     * Background connection completions are accepted only while their captured
     * slot is still current. This is the same stale-result guard used by Claude
     * Code's MCP reconcile: an old connection may finish, but it cannot revive
     * a removed/replaced server in the connected cache.
     */
    private readonly runtimeSlots;
    private nextRuntimeGeneration;
    private readonly connectedServersCache;
    /**
     * Runtime generations whose connected instance and deferred-tool index
     * have been committed together to the live caches.
     *
     * A transport may set model.status=CONNECTED before the serialized rebuild
     * finishes. Claude publishes client+tools atomically; this stamp supplies
     * the same wait invariant in WorkBuddy's split model/index architecture.
     */
    private readonly committedRuntimeGenerations;
    /**
     * Eviction-close promises for slots being replaced (same name, new
     * identity due to a config/scope fingerprint change) within a single
     * reconcile revision, keyed by server name.
     *
     * `connectProjectedSlot` awaits the matching entry (if any) before
     * spawning the replacement transport, so the previous transport has
     * actually finished closing before a same-name replacement starts.
     *
     * Without this, `reconcileRevision` fires eviction (`evictServerRuntime`,
     * fire-and-forget) and schedules the replacement's `connectProjectedSlot`
     * via `setImmediate` in the same tick — for a stdio server that holds a
     * local resource (e.g. a sqlite state-file lock), the old OS process may
     * not have exited yet when the new one spawns, so the replacement's
     * `connect()` can fail immediately with a transport-level error even
     * though the previous connection had just succeeded.
     */
    private readonly pendingReplacementEvictions;
    private nonInteractiveMode;
    initialize(): void;
    private syncSandboxSessionChanges;
    private recoverSandboxedStdioServers;
    private indexedDeferServers;
    private cacheDbgInflight;
    private cacheDbgRunSeq;
    private rebuildChain;
    private syncServerModelStatus;
    private enqueueConnectedCacheRebuild;
    /**
     * Rebuilds `connectedServersCache` for a single status-change event.
     *
     * Root-cause note (wiki_mcp "not connected" intermittent failure):
     * Previously each async callback snapshotted `allServersCache.filter(isActive)`
     * at entry, awaited `serverManager.get()`, then unconditionally overwrote the
     * whole shared cache with that snapshot. With several servers connecting at
     * startup, multiple callbacks ran concurrently and whichever's `await`
     * resolved LAST won — so an older, less-complete snapshot could clobber a
     * newer correct one, dropping an already-connected server (e.g. wiki_mcp).
     *
     * Fix: recompute the cache from the LATEST `allServersCache` active set at
     * write time (after the await), and only drop a server that is no longer
     * active — never merely because its instance fetch lagged. Combined with
     * `rebuildChain` serialization this makes the result order-independent.
     */
    private rebuildConnectedCache;
    /** Current active models whose runtime slot still owns their generation. */
    private collectActiveModels;
    private syncToggleStatus;
    private syncToolsListChanged;
    private reindexDeferredToolsForCurrentSlot;
    /**
     * Track pending backoff attempts for degraded `tools/list` recovery (issue #106255).
     * Keyed by `${serverName}#${generation}` so a reconcile that bumps the generation
     * silently invalidates any inflight retry (the runner re-checks slot ownership).
     */
    private degradedRetryAttempts;
    private degradedRetryTimers;
    /**
     * Cancel any pending degraded-listTools retry for `serverName`, regardless of
     * generation. Used from three places:
     *   1. Successful re-index — the chain has done its job, reset the counter
     *      so a *future* degrade starts from the 5s base again.
     *   2. Slot removal / replacement — the pending timer for the old
     *      generation would otherwise sit in the event loop for up to 5 minutes.
     *   3. Server disconnected — pointless to keep retrying against nothing.
     *
     * Iterates all keys prefixed with `serverName#` so we cover both current
     * and stale generations in one pass.
     */
    private cancelDegradedRetryChain;
    /**
     * Schedule a backoff retry after a degraded `listTools` fallback (issue #106255).
     *
     * The retry re-enters through `reindexDeferredToolsForCurrentSlot`, which:
     * - re-checks the slot generation and bails if it changed,
     * - resets the `listTools` cooldown so the retry actually hits upstream,
     * - schedules the next attempt if the fetch degrades again,
     * - cancels the chain on successful commit.
     *
     * Equal jitter (±25%) prevents lockstep retries when several servers degrade
     * in the same window (typical during cold-start MCP fan-out contention).
     *
     * De-dup guard: if a timer for this exact slot key is already armed, keep it
     * — don't replace it with a fresh (later) one. This is important because
     * `rebuildConnectedCache` and `reindexDeferredToolsForCurrentSlot` can both
     * fire schedule calls for the same slot within the same tick (e.g. a
     * `tools/list_changed` arriving 100ms after a status-driven degrade), and
     * we don't want two entries or a reset countdown.
     */
    private scheduleDegradedListToolsRetry;
    /**
     * Watches `McpConfigManager` for scope mutations and forces a re-scan when
     * new servers might have been added after a previous `list()` populated an
     * empty cache.
     *
     * Concrete failure mode this fixes (regression from PR #38260):
     *   1. ACP / SDK headless startup → `McpReadyService` calls
     *      `McpCliConfigInitializer.initialize()` which sets DYNAMIC=`{}` and
     *      triggers `setNonInteractiveMode(true)` → `list()` runs against an
     *      empty config and sets `allServersCacheInitialized=true`.
     *   2. Client subsequently issues ACP `newSession({mcpServers})` →
     *      `mcp-validate-middleware` writes the real DYNAMIC config and calls
     *      `setNonInteractiveMode(true)` again, but `list()` short-circuits on
     *      the stale "initialized" flag and returns the empty cache.
     *   3. Servers never connect, no tools indexed.
     *
     * Strategy: invalidate the flag on every config mutation. If we are
     * already in non-interactive mode, eagerly trigger `list()` so the new
     * servers begin connecting without waiting for the next caller. Skip
     * re-trigger when no `list()` has happened yet (initialization path —
     * letting `setNonInteractiveMode` drive the first scan as today).
     */
    private syncConfigChanges;
    add(name: string, config: McpConfig, scope?: McpScope): Promise<void>;
    remove(name: string, scope?: McpScope): Promise<void>;
    get(name: string, scope?: McpScope): Promise<McpServerModel | undefined>;
    list(scope?: McpScope): Promise<McpServerModel[]>;
    getProjectedPluginServerNames(): readonly string[];
    previewEffectivePluginServerNames(pluginConfigs: McpDataValue): Promise<readonly string[]>;
    /**
     * Serialize a desired-state projection without holding the queue open for
     * network connections. Every distinct desired revision receives a queue
     * entry; a later mutation can never be represented by an older in-flight
     * promise.
     */
    private enqueueReconcile;
    /**
     * Join every trailing revision appended while the caller's current tail is
     * running. Capturing `this.reconcileTail` only once lets the original
     * `list()`/reload caller resolve after revision N even when a config change
     * observed during N has already queued N+1.
     *
     * This waits for queue stability, not future mutations after the observed
     * tail has settled, so an idle interactive process does not become a
     * perpetual config-change barrier.
     */
    private waitForReconcileTailToStabilize;
    /**
     * Publish the latest plugin desired state and return once its runtime
     * projection is visible. Unchanged plugin MCP servers are retained and new
     * or replaced servers connect in the background.
     */
    reloadPluginServers(): Promise<void>;
    private reconcileRevision;
    private isCurrentRuntimeSlot;
    private evictServerRuntime;
    /**
     * Make a denied name uncallable now, then close the stale-create race.
     *
     * `McpServerManager.create()` is serialized per name. An allowed
     * generation may already be inside `instantiateServer()` when reconcile
     * projects a same-name PENDING_APPROVAL slot. The first eviction cannot
     * delete an instance which has not entered the cache yet, so wait for that
     * create chain to drain and evict once more — but only if the exact denied
     * generation is still current. A later allowed generation therefore can
     * never be deleted by this cleanup.
     */
    private evictDeniedRuntime;
    private connectProjectedSlot;
    listTools(name: string, scope?: McpScope): Promise<McpTool[]>;
    getLocations(): Promise<McpLocation[]>;
    getServerAllTools(): Promise<Map<string, McpTool[]>>;
    reconnect(name: string, scope?: McpScope): Promise<boolean>;
    startOAuthFlow(name: string, scope?: McpScope): Promise<string>;
    hasValidOAuthTokens(name: string): Promise<boolean>;
    invalidateOAuthCredentials(name: string, credentialScope?: 'all' | 'client' | 'tokens' | 'verifier'): Promise<void>;
    /**
     * 设置非交互模式状态
     * @param nonInteractive 是否为非交互模式
     *
     * Note: this fires `list()` once but does NOT await it. Late-arriving
     * config writes (e.g. ACP middleware writing DYNAMIC scope after this
     * scan starts) are handled by `syncConfigChanges()`, which invalidates
     * the cache and triggers a rescan via `changedSubject`.
     */
    setNonInteractiveMode(nonInteractive: boolean): void;
    /**
     * 检查是否在非交互模式
     */
    private isNonInteractiveMode;
    /**
     * A scan has fully settled once the latest desired revision is projected
     * and no server is still pending/connecting or awaiting its atomic
     * connected-instance + deferred-tool-index commit.
     */
    private allServersSettled;
    private isServerPendingOrUncommitted;
    /**
     * 单个 model 是否属于 `waitForPendingServers` 的阻塞集合：names 过滤（缺省=全量，
     * 空Set=谁都不匹配）+ pending/uncommitted 判据。抽出来做**单一真理来源**，让
     * 阻塞侧（waitForPendingServers）与展示侧（banner 的 statusServers）永远同集合。
     */
    private matchesPendingBlockingFilter;
    /**
     * 返回 `waitForPendingServers` 在同参下**会阻塞等待**的确切 server 名单。
     * 供first-run banner 展示——展示集合必须 == 真正阻塞首个 prompt 的集合。
     *
     * **必须先 `await this.list()`**：与 `waitForPendingServers`（line 1500）同构。
     * `list()` 触发 projection 把当前 desired-state 物化进 `allServersCache`；跳过它
     * 会在冷启动早期读到尚未填充的空 cache → 展示集合空 → banner 不显示（实测回归）。
     *
     * names 语义与 waitForPendingServers 完全一致：
     * - undefined → 全量 pending/uncommitted
     * - 非空数组 → 名单 ∩ pending/uncommitted
     * - 空数组   → 空（谁都不阻塞，也就不展示）
     */
    listPendingOrUncommittedServerNames(options?: {
        names?: readonly string[];
    }): Promise<string[]>;
    waitForPendingServers(options?: {
        names?: readonly string[];
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<void>;
    waitForServer(name: string, options?: {
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MCPServer | undefined>;
    getConnectedServers(options?: {
        waitForSettle?: boolean;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<MCPServer[]>;
    /**
     * 检查指定服务器在哪些作用域中存在
     * @param name 服务器名称
     * @returns 包含该服务器的作用域数组
     */
    getServerScopes(name: string): Promise<McpScope[]>;
    allow(serverNames: string[]): Promise<void>;
    deny(serverNames: string[]): Promise<void>;
    allowAllForever(): Promise<void>;
    /**
     * Permission settings live outside MCP config files, so changing them does
     * not emit McpConfigManager.changedSubject. Advance desired state
     * explicitly and join the serialized reconcile tail; otherwise a cached
     * PENDING_APPROVAL/CONNECTED projection survives indefinitely until an
     * unrelated config write happens.
     */
    private reconcilePermissionDecision;
    getAllNeedingApproval(): Promise<string[]>;
    toggleServer(name: string, enable: boolean): Promise<void>;
    isServerDisabled(name: string): boolean;
    getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    /**
     * 上报 mcp_get_prompt 埋点（仅 WorkBuddy Desktop 宿主下触发）。
     *
     * 字段契约对齐 VSCode 源头（packages/agent-mcp/src/common/services/mcp-client-service.ts）：
     *   - id:                 MCP server ID；agent-cli 无该字段，留空串
     *   - name:               MCP server name
     *   - toolName:           prompt 名称
     *   - toolArgs:           JSON 字符串化的 prompt 参数
     *   - toolCallSuccessful: 成功 true / 失败 false
     */
    private reportMcpGetPrompt;
    /**
     * 索引服务器的 defer 工具到 ToolSearchService
     *
     * 支持全局 defer loading 配置：
     * - Tool 级配置 > Server 级配置 > 全局配置
     * - 全局配置为 true 时，所有 MCP 工具默认 defer
     */
    private discardStaleDeferredIndex;
    private indexDeferredToolsForServer;
}
