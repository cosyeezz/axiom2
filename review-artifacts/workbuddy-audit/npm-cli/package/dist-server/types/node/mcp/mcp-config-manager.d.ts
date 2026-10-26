import { Logger } from '@celljs/core';
import { PluginManager } from '../../vendor/cbc-plugins/node/plugins/plugin-protocol.js';
import { Subject } from 'rxjs';
import { CliSettingSourcesProvider } from '../settings/cli-setting-sources-provider';
import { McpConfig, McpConfigDiagnosticsManager, McpConfigEnvExpandService, McpConfigManager, McpConfigStore, McpDataValue, McpLogService, McpScope, ScopedMcpConfig } from './mcp-protocol';
export { userMcpDescriptorEnvironment } from './mcp-descriptor-environment';
export declare class McpConfigManagerImpl implements McpConfigManager {
    /**
     * Notifies subscribers when any scope's config has been mutated.
     * Emitted by mutations, cache invalidation and strict-source policy changes.
     *
     * `McpManager` subscribes to invalidate its `allServersCacheInitialized`
     * flag so a subsequent `list()` re-scans — required for the ACP path,
     * where DYNAMIC scope is written by `mcp-validate-middleware` AFTER
     * `McpReadyService` has already pre-warmed an empty `list()`.
     */
    readonly changedSubject: Subject<{
        scope: McpScope;
    }>;
    protected readonly configStore: McpConfigStore;
    protected readonly logger: Logger;
    protected readonly mcpLogService: McpLogService;
    protected readonly pluginManager: PluginManager;
    protected readonly cliSettingSourcesProvider: CliSettingSourcesProvider;
    protected readonly envExpandService: McpConfigEnvExpandService;
    protected readonly diagnosticsManager: McpConfigDiagnosticsManager;
    /** Stores raw config templates (with `${VAR}` placeholders intact) */
    private scopeDataCache;
    /**
     * In-flight read promises per scope, used to dedupe concurrent `list(scope)` calls.
     * Multiple callers arriving during the same read window share one Promise, avoiding
     * the "thundering herd" pattern where N parallel callers each issue their own read.
     */
    private inflightReads;
    private strictMcpConfig;
    private dynamicConfigInitialized;
    private readonly mcpToSettingsScopeMap;
    get(scope: McpScope, name: string): Promise<McpConfig>;
    set(scope: McpScope, configs: McpDataValue): Promise<void>;
    set(scope: McpScope, name: string, config: McpConfig): Promise<void>;
    delete(scope: McpScope, name: string): Promise<boolean>;
    list(): Promise<Record<McpScope, McpDataValue>>;
    list(scope: McpScope): Promise<McpDataValue>;
    protected getDescriptorEnvironment(): Readonly<NodeJS.ProcessEnv>;
    listDeclaredUser(cwd: string): Promise<{
        mcpServers: McpDataValue;
        disabledMcpServers: string[];
    }>;
    private readMcpServersFromPlugins;
    private normalizePartialData;
    private readInternal;
    private readSdk;
    /**
     * Await DYNAMIC scope initialization, bounded by {@link DYNAMIC_CONFIG_INIT_TIMEOUT_MS}.
     * Internal read paths must never block forever on this deferred — see the constant's doc.
     */
    private awaitDynamicConfigInitialized;
    private readDynamic;
    private isStrictMcpScopeBlocked;
    /** Check whether a scope is enabled by strict mode and settingSources. */
    private shouldLoadScope;
    /** Read scope data and capture whether this specific result may be cached. */
    private read;
    private writeServerConfigs;
    setStrictDynamic(strictDynamic: boolean): void;
    isStrictMcpConfig(): boolean;
    /**
     * Invalidate cached config for filesystem-backed scopes so the next read
     * re-loads from disk.
     *
     * PROJECT (`<cwd>/.mcp.json`) and LOCAL (`~/.codebuddy.json` projects[cwd])
     * resolve their file path from the current working directory. When cwd
     * changes (prewarm activate chdir / worktree switch), any previously cached
     * scope data was read against the OLD cwd and is stale — a subsequent
     * `list(PROJECT)` would return a cache hit for the wrong directory. These
     * two are always invalidated.
     *
     * USER is cwd-independent, so ordinary cwd changes leave it alone. The
     * prewarm activation path passes `includeUser` to discard any short-lived
     * Store miss immediately after provisioning, rather than waiting up to its
     * one-second TTL. Missing filesystem scopes are never stored in this
     * manager's cache.
     *
     * Drops the cache entries and any in-flight reads for the selected scopes,
     * then emits `changedSubject` per scope so `McpManager.syncConfigChanges`
     * re-scans if a `list()` had already settled.
     */
    invalidateFilesystemScopeCaches(opts?: {
        includeUser?: boolean;
    }): void;
    invalidatePluginScopeCache(): void;
    getByName(name: string): Promise<ScopedMcpConfig[]>;
    /**
     * 等待动态配置初始化完成
     * 用于确保 --mcp-config 参数已被解析
     */
    waitDynamicConfigInitialized(): Promise<void>;
    /**
     * Expand environment variables for all configs in a scope.
     * Returns a new McpDataValue with expanded values; the original is not mutated.
     * Diagnostics are reported to McpConfigDiagnosticsManager.
     */
    private expandScopeData;
    /**
     * Expand environment variables in a single config.
     * Reports diagnostics and logs warnings for missing variables.
     * Falls back to the original config if expansion fails.
     */
    private expandSingleConfig;
}
