import { ContainerUtil, Emitter } from '@celljs/core';
import { CliRuntimeOptions } from '../../../../node/cli/cli-runtime-options.js';
import { ConsoleManager } from '../../../../node/console/console-protocol.js';
import { FileLockService } from '../../../../node/lock/lock-protocol.js';
import { McpPluginRegistry } from '../../../../node/mcp/mcp-plugin-registry.js';
import { CliSettingSourcesProvider } from '../../../../node/settings/cli-setting-sources-provider.js';
import { SettingsManager, SettingsScope } from '../../../../node/settings/settings-protocol.js';
import { PluginTelemetryService } from '../../../../node/telemetry/plugin-telemetry-protocol.js';
import { StartupProfiler } from '../../../../node/telemetry/startup-profiler-protocol.js';
import { type ProcessIdentity } from '../../../../node/utils/process-identity.js';
import { Logger } from '@genie/telemetry';
import { PluginLoaderManager } from './loaders/plugin-loader-manager';
import { GitFallbackCoordinator } from './marketplaces/git-fallback-coordinator';
import { PluginOptionsStorage } from './plugin-options-storage';
import { type PluginPolicyService } from './plugin-policy-service';
import { type ActivePluginRefreshOptions, type ActivePluginRuntimeEntry, BuiltInMarketplaceProvider, Marketplace, MarketplaceAddOptions, MarketplaceConfigManager, MarketplaceInfo, MarketplaceSelectionOptions, MarketplaceStorage, MarketplaceUpdateChecker, MarketplaceUpdateOptions, PluginComponents, PluginDependencyRepairResult, PluginErrorCollector, PluginInfo, PluginInstaller, PluginInstallOptions, PluginLoadGuard, PluginManager, PluginPruneOptions, PluginRepairOptions, PluginUninstallOptions, type PluginWorkspaceEnabledState, type PluginWorkspaceMarketplaceCatalog, type PluginWorkspaceRuntimePreparation } from './plugin-protocol';
/** Retain stage failures for library hosts while preserving CLI rejection/logging. */
export declare class PluginManagementPassError extends Error {
    readonly failures: ReadonlyArray<{
        stage: string;
        error: unknown;
    }>;
    constructor(failures: ReadonlyArray<{
        stage: string;
        error: unknown;
    }>);
}
interface InstallBuiltInMarketplacesOptions {
    marketplaceNames?: readonly string[];
    throwOnFailure?: boolean;
    /** Caller will refresh installed plugins after composing more marketplace changes. */
    skipInstalledPluginRefresh?: boolean;
}
/**
 * 插件管理器实现
 * 负责插件的安装、卸载、启用、禁用等核心功能
 * 同时负责管理插件市场,支持多种Provider(本地/Git/HTTP)
 */
export declare class PluginManagerImpl implements PluginManager {
    protected componentServices?: typeof ContainerUtil;
    protected get services(): typeof ContainerUtil;
    protected getEnvironment(): NodeJS.ProcessEnv;
    protected createMarketplace(info: MarketplaceInfo): Marketplace;
    protected readonly logger: Logger;
    protected readonly marketplaceStorage: MarketplaceStorage;
    protected readonly settingsManager: SettingsManager;
    protected readonly cliSettingSourcesProvider: CliSettingSourcesProvider;
    protected readonly cliRuntimeOptions?: CliRuntimeOptions;
    protected readonly fileLockService: FileLockService;
    protected readonly pluginLoaderManager: PluginLoaderManager;
    protected readonly pluginOptionsStorage?: PluginOptionsStorage;
    protected readonly installers: PluginInstaller[];
    protected readonly marketplaceConfigManager: MarketplaceConfigManager;
    protected readonly builtInMarketplaceProvider: BuiltInMarketplaceProvider;
    protected readonly errorCollector: PluginErrorCollector;
    protected readonly consoleManager: ConsoleManager;
    protected readonly startupProfiler: StartupProfiler;
    protected readonly pluginTelemetryService: PluginTelemetryService;
    protected readonly pluginPolicyService: PluginPolicyService;
    protected readonly gitFallbackCoordinator: GitFallbackCoordinator;
    protected readonly marketplaceUpdateChecker: MarketplaceUpdateChecker;
    protected readonly pluginLoadGuard?: PluginLoadGuard;
    protected readonly mcpPluginRegistry?: McpPluginRegistry;
    protected readonly onDidChangeEmitter: Emitter<void>;
    readonly onDidChange: import("@celljs/core").Event<void>;
    /** Runtime-visible plugin set. Management mutations never rewrite it. */
    private activePlugins;
    /** 已安装插件缓存 */
    private installedPluginsCache?;
    /** 已安装插件加载中的 Promise（用于去重并发加载） */
    private installedPluginsLoading?;
    /** installed_plugins.json 缓存，避免每个插件 hydrate 都重复读磁盘 */
    private installedPluginsRegistryCache?;
    /** installed_plugins.json 加载中的 Promise（用于去重并发读取） */
    private installedPluginsRegistryLoading?;
    /** installed_plugins.json 的进程内写队列。 */
    private installedPluginsRegistryWriteLock;
    /** 缓存的市场列表 */
    private marketplaceCache?;
    /** 当前 marketplace registry 投影的进程内 single-flight。 */
    private marketplaceLoading?;
    /** 独立于插件缓存代际，阻止失效前启动的 marketplace 读取成为 last writer。 */
    private marketplaceGeneration;
    /** 同一 marketplace 的并发更新共享一次远端同步，并扇出进度事件。 */
    private marketplaceUpdates;
    /** 市场插件列表缓存 */
    private marketplacePluginsCache;
    /**
     * #74359 跨进程一致性：cache 写入时记录磁盘 marketplace.json 的 mtimeMs，下次 HIT 前
     * 比对，磁盘更新说明别的 sidecar host 已刷 manifest，本 host cache 作废。
     */
    private marketplacePluginsCacheMtime;
    /** 市场插件列表加载中的 Promise（用于去重并发扫描） */
    private marketplacePluginsLoading;
    /** Per-marketplace generation prevents an invalidated scan from repopulating the cache. */
    private marketplacePluginsGeneration;
    /** 插件组件缓存 */
    private pluginComponentsCache;
    /** 插件组件加载中的 Promise（用于去重并发加载） */
    private pluginComponentsLoading;
    /** enabledPlugins 缓存 */
    private enabledPluginsCache?;
    /**
     * `--settings` 插件依赖只在当前进程生效。它们不能写入用户配置，
     * 但必须参与后续 reload，否则根插件会因依赖未出现在 enabledPlugins 中而被降级。
     */
    private sessionEnabledPluginOverrides;
    /** inline 插件缓存（独立于 marketplace 缓存，运行期间不清除，仅 /reload-plugins 清除） */
    private inlinePluginsCache?;
    /** 缓存代际，用于丢弃 clearAllCaches 前启动的旧加载结果 */
    private cacheGeneration;
    /** 首个运行时消费者触发的惰性初始化 Promise。 */
    private initPromise?;
    /** 当前 Agent CLI 进程的后台 Plugin 管理 single-flight。 */
    private backgroundPluginManagementPromise?;
    /** Enabled local-directory plugins whose early install failed this process. */
    private localInstallFailuresSet?;
    private get localInstallFailures();
    /**
     * Strict desired-state materialization shared by explicit host readiness
     * and the first phase of background management. Only in-flight work is
     * shared: each later call rechecks disk so external cache deletion heals.
     */
    private configuredPluginReconcilePromise?;
    private configuredPluginReconcileGeneration;
    /** 管理态监听器只注册一次，--no-plugin-management 运行时不注册。 */
    private pluginManagementListenersRegistered;
    /** `whenReady()` 的共享 Promise，避免并发调用各自包装出不同句柄。 */
    private readyPromise?;
    /** doInit 完成后才允许外部 marketplace 操作触发依赖修复。 */
    private initializationComplete;
    /** 待重试的合并插件策略（市场未就绪时暂存） */
    private pendingManagedPolicies;
    /** 上次 apply 期间是否有新的请求到达 */
    private pendingApplyRequest;
    /** 当前管控策略应用；并发触发者共享并等待同一轮（含 pending 补跑）。 */
    private managedPoliciesApplyPromise?;
    /** Pending 策略最大存活时间（30 分钟） */
    private static readonly PENDING_MAX_AGE_MS;
    /** Pending 策略最大重试次数 */
    private static readonly PENDING_MAX_RETRY;
    /**
     * 是否正在响应 ProductManager 配置变更并重跑 installBuiltInMarketplaces，防重入。
     * 场景：嵌入式进程启动时拿到的是默认 Product 配置（可能只有部分 builtin），
     * 之后宿主推送完整的 Product 配置
     * （例如 `cb_teams_marketplace`）。如果不在配置变更时再跑一次安装，新增的 builtin
     * 永远不会被 first-install，后续 update 路径会一直拿到
     * `Marketplace ${name} does not exist` 报 HTTP 500。
     */
    private isReinstallingBuiltInMarketplaces;
    /** 上一轮 reinstall 期间是否又有新的 ProductManager.onDidChange 到达。 */
    private pendingReinstallRequest;
    /** 当前 Product 触发的 builtin marketplace 刷新，供启动屏障等待。 */
    private builtInMarketplaceRefreshPromise;
    /** 当前进程内全量 built-in marketplace 安装 single-flight。 */
    private builtInMarketplaceInstallPromise?;
    /** Markers owned by this manager; lazily initialized for decorator-free unit fixtures. */
    private ownedPluginCacheMarkers?;
    /** Loaded-cache marker sweeping is best-effort and single-flight within this process. */
    private pluginCacheInUseSweepPromise?;
    protected init(): void;
    protected disposePluginCacheMarkers(): Promise<void>;
    /**
     * Initialize exactly once, after runtime argv and settings providers have
     * settled. PostConstruct intentionally does not read session configuration.
     */
    private ensureInitialized;
    protected doInit(): Promise<void>;
    private isPluginManagementDisabled;
    isBackgroundManagementEnabled(): boolean;
    private assertPluginManagementAllowed;
    protected registerPluginManagementListeners(): void;
    private invalidateConfiguredPluginReconcile;
    /**
     * Materialize the complete Product/persisted-settings desired state.
     * Concurrent callers, including startup background management, share one
     * strict pass. If settings change while it is running, the same owner loops
     * once more rather than allowing two management passes to cross.
     */
    reconcileConfiguredPlugins(): Promise<void>;
    /** Start one management pass after the initial cache projection commits. */
    startBackgroundPluginManagement(): Promise<void>;
    private resolveRealPathStrictlyInside;
    private migrateLegacyEnabledPluginCaches;
    private isUnknownInstalledPluginRecord;
    private migrateUnknownPluginCaches;
    private migrateUnknownPluginCacheAndRecord;
    private ensurePluginCacheForMigration;
    private migrateUnknownInstalledPluginRecord;
    /** Complete management-only work after the first cache projection. */
    private prepareStartupPluginManagement;
    private runPluginManagementStage;
    /** Reconcile desired state after the first cache-first snapshot is live. */
    private installMarketplacesFromSettingsAsync;
    /** Embedders can own the delay/queue; standalone CLI keeps its existing scheduler. */
    protected scheduleMarketplaceAutoUpdate(): void;
    /**
     * 订阅 ProductManager 配置变化，捕获 server 推送的 builtInMarketplaces 增量。
     *
     * 设计要点：
     * - 直接复用 `installBuiltInMarketplaces`，它本身幂等（已安装的会被 filter 掉），
     *   只会真正 add 新增的 builtin。
     * - 用 `isReinstallingBuiltInMarketplaces` 防重入；触发期间再来事件标记
     *   `pendingReinstallRequest`，结束后再跑一次，避免错过末次配置。
     * - 安装完成后 fire 一次 `onDidChangeEmitter`，让嵌入式消费方能在 builtin
     *   集合变化后刷新。
     */
    private subscribeToProductBuiltInMarketplacesChange;
    /**
     * 响应一次 ProductManager.onDidChange，按需补跑 installBuiltInMarketplaces。
     * 自带防重入：跑的时候来的事件不会真的并发跑，而是合并成 1 次后续重跑。
     *
     * 重要：仅在 `installBuiltInMarketplaces` 真的改了 marketplace 存储（新增或删孤儿）时
     * 才 fire `onDidChangeEmitter`。否则 `PluginsProductProvider` 会在 1s 防抖后回调
     * `productManager.sync()`，再次触发本方法，形成无限循环（每秒打一次
     * `/config/models` 等接口）。
     */
    private handleBuiltInMarketplacesConfigChange;
    /**
     * 加载市场配置
     */
    private loadMarketplaces;
    private doLoadMarketplaces;
    /**
     * 获取市场自动更新的刷新窗口（毫秒）
     * 默认 24 小时；可通过环境变量 CODEBUDDY_MARKETPLACE_AUTO_UPDATE_INTERVAL_MS 覆盖，
     * 便于测试/调试场景下缩短检测间隔（如设为 1 小时）
     */
    private getMarketplaceAutoUpdateIntervalMs;
    /**
     * 检查市场是否需要自动更新
     * @param marketplace 市场信息
     * @returns true 如果需要自动更新
     */
    private shouldAutoUpdate;
    /**
     * 自动更新所有启用自动更新的市场
     * 该方法会异步执行,不阻塞主流程
     */
    protected autoUpdateMarketplaces(): Promise<void>;
    /**
     * 添加市场
     */
    addMarketplace(source: string, options?: MarketplaceAddOptions): Promise<Marketplace>;
    /**
     * 删除市场
     */
    removeMarketplace(name: string, options?: MarketplaceSelectionOptions): Promise<void>;
    private removeMarketplaceLocked;
    /**
     * 更新市场
     */
    updateMarketplace(name: string, options?: MarketplaceUpdateOptions): Promise<Marketplace>;
    private doUpdateMarketplace;
    /** Fetch and validate private bytes before taking publication locks. */
    private prepareMarketplaceUpdate;
    private doUpdateMarketplaceLocked;
    /**
     * 列出所有市场
     */
    listMarketplace(): Promise<Marketplace[]>;
    /**
     * 获取市场信息
     */
    getMarketplace(name: string): Promise<Marketplace | undefined>;
    getMarketplaceByStorageName(name: string): Promise<Marketplace | undefined>;
    createWorkspaceDirectoryMarketplace(marketplaceName: string, directory: string): Marketplace;
    resolveMarketplacesForWorkspace(workspacePath: string): Promise<PluginWorkspaceMarketplaceCatalog>;
    private indexWorkspaceMarketplaceCatalog;
    private workspaceMarketplaceResolver;
    /**
     * 设置市场自动更新状态
     */
    setMarketplaceAutoUpdate(name: string, autoUpdate: boolean): Promise<void>;
    /**
     * 从市场获取插件列表
     */
    getPlugins(marketplaceName: string): Promise<PluginInfo[]>;
    private getMarketplacePluginsCacheKey;
    private clearMarketplacePluginCaches;
    /**
     * #74359 stat 磁盘上的 marketplace.json 拿到 mtimeMs，用于跨进程 stale check。
     * 找不到 manifest / stat 失败时返回 0——上层会把它当作"没有可信 mtime"跳过 stale 判定。
     */
    private getMarketplaceManifestMtimeMs;
    /**
     * 判断 marketplace 在 update 前是否需要先做"市场级远端同步"。
     *
     * 整体式 marketplace（git/github/zip/url）下所有插件都来自同一远端，必须在
     * marketplace 这一层 fetch / 重新下载，per-plugin 的 installer.update 退化
     * 为路径有效性兜底。directory 类型市场的 source of truth 在用户硬盘上，不需要
     * 也不应该触发远端同步。
     */
    private marketplaceNeedsRemoteSync;
    private clonePluginInfo;
    private clonePluginInfos;
    private listMarketplacePlugins;
    private getPluginId;
    protected getHomePluginsDir(): string;
    private getInstalledPluginsRegistryPath;
    private getInstalledPluginsRegistryLockName;
    private getMarketplaceMutationLockName;
    private getMarketplaceSourceMutationLockName;
    private isSameMarketplaceMutationIdentity;
    private normalizePluginMarketplace;
    private withCommittedMarketplaceRead;
    private selectCurrentCommittedMarketplace;
    private withMarketplaceMutationLock;
    private withMarketplaceSourceMutationLock;
    private acquireMarketplaceSourceMutationLock;
    private getPluginCacheMutationLockName;
    private withPluginCacheMutationLocks;
    private createEmptyInstalledPluginsRegistry;
    private normalizeInstalledPluginsRegistry;
    private addNormalizedInstalledPluginRecord;
    private readInstalledPluginsRegistry;
    private loadInstalledPluginsRegistryFromDisk;
    private migrateLegacyInstalledPluginsRegistry;
    private writeInstalledPluginsRegistry;
    private renameInstalledPluginsRegistry;
    private mutateInstalledPluginsRegistry;
    private cloneInstalledPluginsRegistry;
    private sanitizeCacheSegment;
    private getPluginCachePath;
    private getPluginCacheRoot;
    private assertPathInside;
    private pluginPathExists;
    private findPluginManifestPath;
    private readPluginManifest;
    private getGitPluginCacheVersion;
    private resolvePluginCacheIdentity;
    private resolveGitCommitSha;
    private materializePluginCache;
    private replacePluginCacheAtomically;
    private pathEntryExists;
    private isValidMaterializedPluginCache;
    private isPathInside;
    private safeRealpath;
    private copyPluginToCache;
    private declaredDependenciesOf;
    private recordInstalledPlugin;
    private getProjectPathForScope;
    private toInstalledPluginScope;
    private installedRecordMatchesScope;
    private removeInstalledPluginRecordsForScope;
    private removeInstalledPluginRecordsForMarketplace;
    private getInstalledPluginIdsForMarketplace;
    private removeEnabledPluginEntriesForInstalledRecords;
    private collectPluginMcpServerNames;
    private collectInstalledRecordMcpServerNames;
    private invalidatePluginMcpOAuthCredentials;
    private cleanupFinalPluginState;
    private markPluginCacheOrphaned;
    private isVersionedPluginCachePath;
    private getOwnedPluginCacheMarkers;
    private getRuntimePlatform;
    private getCurrentProcessIdentity;
    /**
     * Version cache roots are real directories in the plugin cache ABI. A
     * symlinked cache leaf (or an ancestor escaping the cache root) is refused
     * so marker writes can never land in an arbitrary symlink target.
     */
    private resolvePluginCacheMarkerDir;
    private recordPluginCacheInUse;
    private releasePluginCacheInUse;
    /** Shares the exact implementation used by process.on('exit'). */
    private releasePluginCacheInUseSync;
    private markPluginCachesInUse;
    private isProcessAlive;
    private queryProcessStartIdentity;
    private lookupProcessInstance;
    private getProcessMarkerState;
    private createPluginInUseSweepStats;
    private removeStalePluginCacheMarker;
    private sweepPluginCacheMarkers;
    private getPluginInUseSweepStampPath;
    private isPluginInUseSweepDue;
    private updatePluginInUseSweepStamp;
    private sweepPluginCachesInUse;
    private schedulePluginCacheInUseSweep;
    private isPluginCacheInUse;
    private listChildDirectories;
    private removeDirectoryIfEmpty;
    private cleanupOrphanedPluginCache;
    private cleanupPluginCache;
    private versionSatisfiesRange;
    private chooseHighestVersion;
    private findCachedPluginByDirectory;
    private getInstalledRecordVersion;
    private resolveInstalledPluginCache;
    private normalizePluginDependencies;
    private throwDependencyResolutionError;
    private recordDependencyResolutionError;
    private getRootMarketplaceCrossDependencyAllowlist;
    private getNormalizedSemver;
    private getEffectivePluginVersion;
    private assertDependencyVersion;
    private combineVersionRanges;
    private collectExistingDependencyConstraints;
    private resolveRequestedPluginRefs;
    private isGitBackedMarketplace;
    private runGit;
    private listMarketplacePluginTags;
    private checkoutMarketplaceRef;
    private readMarketplacePluginFromLocation;
    private isGitPluginSource;
    private getPluginGitUrl;
    private listRemotePluginTags;
    private selectHighestMatchingTag;
    private resolveGitTaggedDependencyPlugin;
    private throwNoMatchingDependencyTag;
    private resolveDependencyPlugin;
    private resolveDependencyClosure;
    private materializePluginRefs;
    private installDependencyClosure;
    private hasMaterializedPluginCache;
    /** 检查插件是否具有完整、可信的本地版本化缓存。 */
    private isValidLocalInstallation;
    /** 检查根插件及其递归本地依赖是否完整且已启用。 */
    private isLocalPluginReady;
    /** 检查已启用插件能否完全从本地安装态运行。 */
    private isLocalPluginReadyForRuntime;
    private enableDependenciesForPlugins;
    private collectKnownDependencyIds;
    private getDeclaredDependencyIds;
    private findOrphanedAutoDependencies;
    private findEnabledDependents;
    private assertNoEnabledDependents;
    private getInstalledPluginsForWorkspaceState;
    /**
     * 加载已安装插件
     */
    private loadInstalledPlugins;
    private applyDependencyRuntimeGuards;
    /**
     * 安装插件
     */
    installPlugins(pluginNames: string[], marketplaceName: string, options?: PluginInstallOptions): Promise<void>;
    /**
     * 使用installer安装插件
     */
    private installPluginWithInstaller;
    private assertExpectedPlugin;
    private archiveCacheMatches;
    private installRemotePlugin;
    private reuseInstalledPluginCache;
    private installPluginWithInstallerLocked;
    private resolveUpToDatePluginCache;
    /**
     * 更新插件
     */
    private refreshInstalledPluginsAfterMarketplaceUpdate;
    private getInstalledPluginNamesForMarketplaceFromRegistry;
    updatePlugins(pluginNames: string[], marketplaceName: string, options?: PluginInstallOptions): Promise<void>;
    /**
     * 卸载插件
     */
    uninstallPlugins(pluginNames: string[], marketplaceName: string, options?: PluginUninstallOptions): Promise<void>;
    prunePlugins(options?: PluginPruneOptions): Promise<string[]>;
    /**
     * 启用插件
     */
    enablePlugins(pluginNames: string[], marketplaceName: string, options?: {
        bypassPolicyCheck?: boolean;
        persist?: boolean;
        scope?: SettingsScope;
        workspacePath?: string;
    }): Promise<void>;
    /**
     * 解析 marketplace 已移除、但本地安装记录仍存在的插件。
     *
     * 仅用于 disable / uninstall / switch 的纯 disable 场景。只有全部目标都能从本地安装态
     * 解析时才允许降级，避免混合批次产生部分写入。Enable 由更严格的本地安装与依赖闭包校验处理。
     */
    private resolveOrphanedPlugins;
    /**
     * 为 marketplace 已移除的插件构建纯本地启用计划。
     *
     * 所有目标插件及其递归依赖必须来自 registry-backed versioned cache，并满足版本约束、
     * 循环依赖和目标 scope 校验。该过程只读取本地安装态，不访问 marketplace，也不会安装
     * 或更新插件；任一目标或依赖无法完整解析时返回 undefined 或抛出依赖解析错误。
     */
    private resolveOrphanedEnablePlan;
    /**
     * 禁用插件
     */
    disablePlugins(pluginNames: string[], marketplaceName: string, options?: {
        persist?: boolean;
        scope?: SettingsScope;
        workspacePath?: string;
    }): Promise<void>;
    /**
     * 原子切换插件：在同一事务中 disable 旧插件 + enable 新插件，只触发一次 onDidChange。
     * 用于plugin切换场景，避免 disable 和 enable 分别触发两次 rebuild cycle。
     */
    switchPlugins(disableNames: string[], enableNames: string[], marketplaceName: string, options?: {
        persist?: boolean;
    }): Promise<void>;
    prepareUserPluginSelection(current: Readonly<Record<string, boolean>>, requested: Readonly<Record<string, boolean>>, editedPluginIds?: ReadonlySet<string>): Promise<Record<string, boolean>>;
    inspectInstalledPlugins(options: {
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
        workspacePath?: string;
    }): Promise<PluginInfo[]>;
    /**
     * 获取已安装插件列表
     */
    getInstalledPlugins(): Promise<PluginInfo[]>;
    /**
     * Build a request-local view straight from installed_plugins.json.
     * Unlike getInstalledPlugins(), this deliberately bypasses the shared
     * installedPluginsCache so an ALS settings overlay cannot leak between
     * concurrent compatibility-verification requests. It performs no install,
     * enable/disable, runtime activation, marker publication, or cache write.
     */
    inspectCommittedPluginsForCurrentSettings(requestedPluginIds?: readonly string[]): Promise<PluginInfo[]>;
    /**
     * 从本地目录加载插件信息（--plugin-dir）
     *
     * inline 插件树读面走 data-fs seam（只读，无副作用）：server 注入 fs 时
     * 从注入卷读取；bin 无注入时为本地直通，行为不变。
     */
    private loadLocalPluginInfo;
    private hydratePluginInfo;
    /**
     * 获取插件信息
     */
    getPlugin(pluginName: string, marketplaceName: string, options?: MarketplaceSelectionOptions): Promise<PluginInfo | undefined>;
    getPluginForWorkspace(pluginName: string, marketplaceName: string, options: {
        marketplace?: Marketplace | null;
        scope: SettingsScope;
        workspacePath: string;
    }): Promise<PluginInfo | undefined>;
    prepareActivePluginsForWorkspace(options: {
        workspacePath: string;
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
    }): Promise<PluginWorkspaceRuntimePreparation>;
    preparePluginMcpForWorkspace(options: {
        workspacePath: string;
        enabledPlugins: Readonly<Record<string, PluginWorkspaceEnabledState>>;
    }): Promise<PluginWorkspaceRuntimePreparation>;
    private materializePluginSelectionForWorkspace;
    private prepareWorkspacePluginRuntime;
    private loadResolvedPluginCommandsAndSkills;
    private loadResolvedPluginMcp;
    private canLoadResolvedPlugin;
    /**
     * 获取插件扩展组件列表
     */
    getPluginComponents(pluginName: string, marketplaceName: string): Promise<PluginComponents | undefined>;
    getActivePlugins(): Promise<readonly ActivePluginRuntimeEntry[]>;
    refreshActivePlugins(options?: ActivePluginRefreshOptions): Promise<readonly ActivePluginRuntimeEntry[]>;
    private prepareActivePlugins;
    private doLoadPluginComponents;
    /** Lazily publish the current immutable Plugin cache projection. */
    whenReady(): Promise<void>;
    /**
     * 清理所有缓存
     */
    private invalidateMarketplaceCache;
    private clearAllCaches;
    /**
     * 使用已更新状态的 PluginInfo 同步内存缓存。
     *
     * 非持久化场景不能重新读取 settings.json，否则会把尚未落盘的旧 status 读回来。
     */
    private syncInstalledPluginsCache;
    /**
     * 清除插件缓存（用于热更新）
     * 公开接口，供外部调用
     */
    clearCache(): void;
    /**
     * 获取所有 inline 插件（带独立缓存）。
     * 不依赖惰性初始化，不调用 getInstalledPlugins，因此不会死锁。
     */
    private getInlinePlugins;
    /**
     * 从插件目录补全 PluginInfo 上的展示字段（commands/skills/hooks 等）。
     * 这些字段仅用于 REST API 展示，实际功能加载走 PluginLoaderManager。
     * 补全策略：plugin.json manifest > 目录扫描，仅在字段为空时填充。
     */
    private enrichPluginInfo;
    /**
     * 将 source 插件的展示字段合并到 target（仅补全 target 中为空的字段）
     */
    private mergePluginFields;
    private mergePluginDependencies;
    private getDependencyDeclarationKey;
    /**
     * inline 插件找不到时的容错处理：仅更新 settings，清缓存，触发事件
     */
    private handleUnresolvableInlinePlugin;
    /**
     * 获取所有启用插件的 bin/ 目录路径（用于注入 Bash PATH）
     * 仅返回实际存在的 bin/ 目录
     */
    getPluginBinPaths(): Promise<string[]>;
    /**
     * 获取插件用户配置选项值
     */
    getPluginOptions(pluginName: string, marketplaceName: string): Promise<Record<string, string | boolean | number>>;
    /**
     * 保存插件用户配置选项值
     */
    savePluginOptions(pluginName: string, marketplaceName: string, values: Record<string, string | boolean | number>): Promise<void>;
    private isPluginOptionPresent;
    /**
     * 按 userConfig schema 校验待保存的选项值。
     * 未知键/类型不符直接抛错（错误信息只含键名，不含值）；
     * 返回仍缺失的 required 键（无传入值且无 default），由调用方结合已存储值判断。
     */
    private validatePluginOptionValues;
    /**
     * 清理特定插件的组件缓存
     * @param pluginName 插件名称
     * @param marketplaceName 市场名称
     */
    private clearPluginComponentsCache;
    /**
     * 按 source 精确查重：用户输入的 source 与已安装任意一条 marketplace 的
     * `source.url` / `source.path` / `source.repo` 匹配到就返回该条。
     *
     * 用于 addMarketplace 的快速去重，避免：
     *  - 同一 GitHub 仓库被重复 clone 并在 known_marketplaces.json 里落成两条
     *  - 内置 marketplace 的 source 被用户再次添加时冒出一条撞名记录
     *
     * 参照 packages/agent-craft/src/common/plugin/plugin-manager.ts:3101-3146 的做法。
     */
    private findMarketplaceBySource;
    /**
     * 从 installLocation 下读取 marketplace.json，返回其 name 字段。
     * 用于 addMarketplace install() 之后的"manifest.name 撞名"额外查重，
     * 读失败或 manifest 无 name 时返回 undefined，由调用方容错。
     */
    private readMarketplaceManifestName;
    /**
     * Upgrade a pre-manifestName registry row from its already-published
     * marketplace source. This is metadata repair only: it never downloads,
     * swaps, or removes source bytes.
     *
     * The caller must hold the source lock followed by the stable alias lock.
     * A fresh registry read and exact source/location CAS prevent an old load
     * from overwriting a concurrent source replacement.
     */
    private repairMarketplaceManifestIdentityLocked;
    private repairMarketplaceManifestIdentity;
    /**
     * 解析源字符串为MarketplaceSource对象
     */
    private parseSource;
    private getEnabledPlugins;
    private getSettingsScopePriority;
    private assertDependencyCanBeEnabledAtScope;
    private setSessionEnabledPlugins;
    /**
     * 生成市场名称
     */
    private generateMarketplaceName;
    private createMarketplaceStagingName;
    private createMarketplaceTransactionSibling;
    private createMarketplacePublicationJournalPath;
    private createMarketplaceLastGoodMarkerName;
    private toMarketplaceRegistryIdentity;
    private ensureMarketplacePublicationGeneration;
    private writeMarketplacePublicationJournal;
    private removeMarketplacePublicationJournal;
    /**
     * Publish a fully prepared remote marketplace snapshot at its durable
     * `marketplaces/<storageName>` path. The caller owns the marketplace-name
     * lock and commits the registry row before calling `commit()`.
     */
    private publishMarketplaceSourceSnapshot;
    /**
     * One-time repair for registry rows written by the source-* regression.
     * Copy first so the registered old path remains readable until the stable
     * path and registry row have both committed.
     */
    private migrateLegacyMarketplaceSourceLocationLocked;
    private migrateLegacyMarketplaceSourceLocation;
    private parseMarketplacePublicationJournalName;
    private parseMarketplacePublicationJournalTempName;
    private hasMarketplacePublicationJournal;
    private getMarketplacePublicationJournalRecoverySource;
    private isMarketplaceRegistryIdentity;
    private marketplaceMatchesRegistryIdentity;
    private readMarketplacePublicationJournal;
    private isMarketplaceIdentityMaterializedAt;
    private recoverMarketplacePublicationJournalLocked;
    /**
     * Recover the narrow crash window after the live source was moved to its
     * transaction backup but before staging was promoted. The registry still
     * names the stable path, so a unique complete backup is the authoritative
     * last-good snapshot. Source/name locks make this idempotent and prevent a
     * cooperating updater from being mistaken for a crashed one.
     */
    private recoverInterruptedMarketplaceSourceSwapLocked;
    private recoverInterruptedMarketplaceSourceSwaps;
    private migrateLegacyMarketplaceSourceLocations;
    private parseMarketplaceTransientArtifact;
    private normalizeTransientCreatedAt;
    private isMarketplaceTransientOwnerGone;
    protected isMarketplaceTransientProcessAlive(pid: number): boolean;
    protected queryMarketplaceTransientProcessIdentity(pid: number): Promise<ProcessIdentity | undefined>;
    private cleanupMarketplaceTransientArtifacts;
    /**
     * #144842 观测版「未注册 stale 目录」扫描：只记日志不删除。
     * 为后续是否开启真实删除积累数据——误删会话级注册目录（experts 等）的风险
     * 先用一个版本的线上观测排除。候选口径见 observeStaleUnregisteredMarketplaceDirs。
     */
    private observeStaleMarketplaceDirs;
    private assertMarketplaceNameAllowed;
    private removeManagedMarketplaceInstall;
    private updateEnabledPlugins;
    /**
     * Built-in marketplaces whose source is a local directory, so installing
     * them is a filesystem projection with no network in the critical path.
     */
    private getDirectoryBuiltInMarketplaceNames;
    /**
     * 安装内置市场
     *
     * @returns 本次调用是否真的修改了 marketplace 存储（新增了 builtin 或删除了孤儿）。
     *          调用方据此决定是否要向下游 fire `onDidChangeEmitter`，避免在 no-op 情况下
     *          形成 `ProductManager.sync` ↔ `PluginManager.onDidChange` 的死循环。
     *          默认调用的 no-op/降级路径返回 false；后台管理可要求把失败向上汇报，
     *          同时继续完成其他幂等阶段并重投影已成功的结果。
     */
    installBuiltInMarketplaces(options?: InstallBuiltInMarketplacesOptions): Promise<boolean>;
    private resolveBuiltInMarketplaceInstallResult;
    private installBuiltInMarketplacesFromCurrentProduct;
    private doInstallBuiltInMarketplaces;
    /**
     * 从 settings 中安装配置的市场
     */
    installMarketplacesFromSettings(options?: {
        marketplaceNames?: readonly string[];
        throwOnFailure?: boolean;
        /** Caller will refresh installed plugins after composing more marketplace changes. */
        skipInstalledPluginRefresh?: boolean;
        /** Explicit Resource workspace; never inferred from the process cwd. */
        workspacePath?: string;
    }): Promise<void>;
    /**
     * 根据 MarketplaceSource 构造源字符串
     */
    private buildSourceString;
    /**
     * Materialize product-declared plugins through the same marketplace →
     * versioned cache → installed registry workflow as an explicit install.
     * `autoEnable:false` means preinstall only; first-run defaults never
     * overwrite an existing true/false setting.
     */
    private installBuiltInMarketPlugins;
    /**
     * Older `updatePlugins` wrote a root's dependencies as `true` into the root's
     * persistent scope even when the root itself was only ever enabled per
     * session (WorkBuddy's welcomemode-design → mcp-miora, #109245). The host
     * marks such plugins `sessionOnly`; this drops exactly those leaked records:
     * a persistent `true` for a sessionOnly plugin that a sessionOnly root
     * declares as its dependency. Explicit `false` records, roots, and plugins
     * the user can toggle are left alone.
     */
    private dropLeakedSessionOnlyDependencyStates;
    private isCurrentDeclaredDirectoryPluginProjection;
    private getBuiltInMarketPluginDeclarations;
    private toSettingsScope;
    /**
     * 检查是否启用第三方市场自动更新
     * 优先级：settings env > this.getEnvironment() > 产品配置
     * @returns 是否启用
     */
    private shouldAutoUpdateThirdPartyMarketplaces;
    /**
     * 检查并安装所有 enabledPlugins 中未安装的插件
     */
    repairEnabledPlugins(options?: PluginRepairOptions): Promise<void>;
    repairMissingPluginDependencies(): Promise<PluginDependencyRepairResult>;
    private repairEnabledPluginDependencies;
    /**
     * Install only the enabled-but-missing plugins whose marketplace is an
     * already-registered local directory. No network is involved, so this can
     * run ahead of remote marketplace downloads; everything else is left to
     * the regular `install-missing-enabled-plugins` stage.
     */
    private installMissingEnabledLocalPlugins;
    getLocalInstallFailures(): ReadonlySet<string>;
    private installMissingEnabledPlugins;
    /**
     * 应用管控策略（防重入 + 排队执行）
     * T1 触发点调用。如果已在执行中，标记 pendingApplyRequest，
     * 当前执行完成后会立刻补执行（do-while），避免 T2/T3/T4 被丢弃。
     */
    private applyManagedPolicies;
    /**
     * 实际执行管控策略：逐条 apply，市场未就绪的加入 pending 队列
     */
    private doApplyManagedPolicies;
    /**
     * 执行单条合并插件策略
     * 合并策略通过 autoEnable + canRemove/canSwitchoff/canEdit 控制插件行为：
     * - 未安装时：自动安装（autoEnable 控制是否同时启用）
     * - 已安装但未启用时：如果 autoEnable !== false，则自动启用
     * @returns 是否产生了变更
     */
    private applySinglePolicy;
    /**
     * 重试 pending 队列中的管控策略
     * 由 T2/T3/T4 触发点调用
     */
    private retryPendingManagedPolicies;
    /**
     * 判断错误是否可重试（市场未就绪）
     */
    private isRetryableError;
}
export {};
//# sourceMappingURL=plugin-manager.d.ts.map