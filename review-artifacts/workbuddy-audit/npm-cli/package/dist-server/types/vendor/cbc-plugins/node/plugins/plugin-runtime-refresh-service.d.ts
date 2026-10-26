import { CliRuntimeOptions } from '../../../../node/cli/cli-runtime-options.js';
import { CommandManager } from '../../../../node/command/command-protocol.js';
import { LSPManager } from '../../../../node/lsp/lsp-protocol.js';
import { McpManager } from '../../../../node/mcp/mcp-protocol.js';
import { OutputStyleManager } from '../../../../node/output-style/output-style-protocol.js';
import { SkillProductProvider } from '../../../../node/product/skill-product-provider.js';
import { CliSettingSourcesProvider } from '../../../../node/settings/cli-setting-sources-provider.js';
import { CliSettingsProvider } from '../../../../node/settings/cli-settings-provider.js';
import { SettingsManager } from '../../../../node/settings/settings-protocol.js';
import { ToolManager } from '../../../../node/tools/tool-protocol.js';
import { AgentManager } from '../../../cbc-core/node/agent/agent-services.js';
import { ProductManager } from '@genie/product';
import { EventService, Logger } from '@genie/telemetry';
import { type ActivePluginRuntimeEntry, type PluginInfo, PluginManager, type PluginRuntimeLoadError } from './plugin-protocol';
export type PluginRuntimeRefreshReason = 'startup' | 'prewarm-activate' | 'background-management' | 'reload-command' | 'acp-host-reconcile' | 'acp-host-refresh' | 'api-explicit-refresh';
export interface PluginRuntimeRefreshResult {
    readonly activePlugins: readonly ActivePluginRuntimeEntry[];
    readonly errors: readonly PluginRuntimeLoadError[];
    readonly repairedDependencies: readonly string[];
    /** Effective enabled roots verified by a strict reconcile, when requested. */
    readonly reconciledPluginIds?: readonly string[];
}
export interface PluginRuntimeRefreshOptions {
    /** Reconcile these plugin lifetimes without restarting unchanged Mods. */
    readonly targetedPluginIds?: readonly string[];
    /**
     * Re-read persisted settings/install state before activation. The
     * temporary in-memory API switch sets this to false because its
     * `persist:false` selection intentionally lives only in PluginManager memory.
     */
    readonly reloadDesiredState?: boolean;
    /**
     * Refuse to publish a reload that changes plugin MCP server names. The
     * command enables this only when an existing prompt cache would be
     * invalidated and the effective agent has no ToolSearch support.
     */
    readonly blockMcpToolChanges?: boolean;
    /** @internal Strict roots checked before publishing a reconciled snapshot. */
    readonly requiredPluginIds?: readonly string[];
}
export interface PluginRuntimeRefreshContext {
    readonly reason: PluginRuntimeRefreshReason;
    readonly targetedPluginIds?: readonly string[];
}
export interface PluginReconcileDiagnostic {
    readonly code: 'management-failed' | 'required-plugin-missing' | 'runtime-load-failed' | 'timeout';
    readonly message: string;
    readonly pluginId?: string;
}
export interface PluginReconcileResult {
    readonly ready: boolean;
    readonly requiredPluginIds: readonly string[];
    readonly missingPluginIds: readonly string[];
    readonly errors: readonly PluginReconcileDiagnostic[];
}
export interface PluginReconcileOptions {
    readonly reason?: string;
    readonly requiredPluginIds?: readonly string[];
}
export interface ConfiguredPluginReconcileOptions {
    /** Bounds only this caller's wait; it never cancels the shared mutation. */
    readonly signal?: AbortSignal;
    /** Optional caller diagnostic label; it never changes reconcile semantics. */
    readonly reason?: string;
    /** Complete Product snapshot supplied by the long-lived Host. */
    readonly productConfig?: Record<string, unknown>;
}
export declare class PluginManagementDisabledError extends Error {
    readonly code = "PLUGIN_MANAGEMENT_DISABLED";
    constructor();
}
export declare class ConfiguredPluginReconcileTimeoutError extends Error {
    readonly code = "PLUGIN_RECONCILE_TIMEOUT";
    constructor();
}
export declare class ConfiguredPluginReconcileAbortedError extends Error {
    readonly code = "PLUGIN_RECONCILE_ABORTED";
    constructor();
}
export declare class PluginReconcileError extends Error {
    readonly result: PluginReconcileResult;
    readonly code = "PLUGIN_RECONCILE_FAILED";
    constructor(result: PluginReconcileResult);
}
export declare class PluginMcpToolChangeBlockedError extends Error {
    readonly added: readonly string[];
    readonly removed: readonly string[];
    constructor(added: readonly string[], removed: readonly string[]);
}
export interface PluginReloadSummary {
    readonly plugins: number;
    readonly disabledPlugins: number;
    readonly commands: number;
    readonly agents: number;
    readonly skills: number;
    readonly hooks: number;
    readonly mcpServers: number;
    readonly lspServers: number;
    readonly errors: number;
}
export declare function summarizePluginReload(activePlugins: readonly ActivePluginRuntimeEntry[], installedPlugins: readonly PluginInfo[], loadErrors: readonly PluginRuntimeLoadError[]): PluginReloadSummary;
/**
 * Claude Code-style active-plugin refresh.
 *
 * Management operations update settings/install state before entering this
 * serialized projection path. `/reload-plugins` only clears runtime discovery
 * caches and reprojects the already-selected plugins; it never turns a runtime
 * refresh into marketplace installation or broad dependency repair.
 */
export declare class PluginRuntimeRefreshService {
    private readonly runtimeListeners;
    /** Runtime participants consume the committed snapshot without starting another refresh. */
    onRuntimeRefreshed(listener: (plugins: readonly ActivePluginRuntimeEntry[], context: PluginRuntimeRefreshContext) => Promise<void>): () => void;
    protected readonly pluginManager: PluginManager;
    protected readonly productManager: ProductManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly cliSettingsProvider: CliSettingsProvider;
    protected readonly cliSettingSourcesProvider: CliSettingSourcesProvider;
    protected readonly cliRuntimeOptions?: CliRuntimeOptions;
    protected readonly agentManager?: AgentManager;
    protected readonly mcpManager?: McpManager;
    protected readonly commandManager?: CommandManager;
    protected readonly lspManager?: LSPManager;
    protected readonly toolManager?: ToolManager;
    protected readonly outputStyleManager?: OutputStyleManager;
    protected readonly skillProductProvider?: SkillProductProvider;
    protected readonly eventService?: EventService;
    protected readonly logger: Logger;
    private refreshTail;
    /** Single-flight final argv/settings publication without holding remote I/O. */
    private settingsPreparation?;
    /**
     * The configured marketplace/plugin mutation itself. It is deliberately
     * separate from caller waiters so a timeout or disconnect never starts an
     * overlapping writer while the first pass still owns filesystem locks.
     */
    private configuredPluginPreparation?;
    /**
     * Product snapshots are complete replacements, so preserve request order
     * while keeping timeout/cancellation scoped to each waiter.
     */
    private configuredPluginPreparationTail;
    /**
     * Latched once the composed system prompt has been projected. Later
     * enable/disable of a compose plugin travels through settings reconcile,
     * which republishes agents behind `waitForRefreshSettled`, so the first-turn
     * gate never has to re-arm.
     */
    private composePluginsProjected;
    private composePluginsGate?;
    /** The first committed runtime snapshot starts exactly one manager pass. */
    private backgroundPluginManagementStarted;
    private backgroundPluginManagementTask?;
    /**
     * A PluginManager mutation (late built-in install after Product config
     * publishes, background enable/disable) changes the desired active set, but
     * nothing re-runs `refreshActivePlugins` on its own — so the committed
     * snapshot can stay stale for the whole process (plugins installed after
     * the startup snapshot would never become readable, e.g. plugin-sourced
     * UserPromptSubmit hooks). Single-flight so writers never overlap.
     */
    private activeSnapshotReprojectTask?;
    /** Startup projection has handed persistent desired state to this owner. */
    private settingsReconcileEnabled;
    /**
     * Persisted settings may be edited by another process after startup. Keep
     * those writes on the long-lived management owner instead of deferring
     * cache materialization until a later Agent Session happens to need the
     * plugin. A generation loop closes the small race where another settings
     * commit arrives while the previous reconcile is reprojecting.
     */
    private settingsReconcileGeneration;
    private settingsReconcileTask?;
    private pluginSettingsSnapshot?;
    private settingsObservationGeneration;
    protected init(): void;
    /**
     * Single-flight reprojection of the committed snapshot. Synchronous by
     * design (mirrors `startSettingsReconcile`): the caller is a change
     * callback, so the work is launched here and tracked, not awaited.
     */
    private runActiveSnapshotReprojection;
    /**
     * True when an enabled plugin is installed on disk but absent from the
     * committed active snapshot — i.e. the snapshot is stale for the desired
     * set. Uses the same scope precedence as activation so it never waits on a
     * plugin the settings would not enable.
     */
    private hasUnprojectedEnabledPlugins;
    private readPluginSettingsSnapshot;
    private observePluginSettingsChange;
    private enqueueSettingsReconcile;
    private startSettingsReconcile;
    private startBackgroundPluginManagementAfter;
    private runBackgroundPluginManagement;
    private reprojectBackgroundPluginState;
    /**
     * @deprecated Read-only compatibility for hosts that still submit
     * requiredPluginIds to /plugins/reconcile. This verifies the committed
     * registry under the request-local settings projection; it never installs,
     * changes enablement, publishes PluginManager caches, or activates runtime
     * components.
     */
    reconcileConfiguredPlugins(options?: PluginReconcileOptions): Promise<PluginReconcileResult>;
    verifyCommittedPlugins(options?: PluginReconcileOptions): Promise<PluginReconcileResult>;
    /**
     * Explicit, host-neutral management boundary for API clients that need the
     * complete configured plugin state to be materialized.
     * Unlike the ordinary headless fallback, this must not silently degrade to
     * cache-only behavior when management is disabled.
     */
    reconcileAllConfiguredPlugins(options?: ConfiguredPluginReconcileOptions): Promise<void>;
    private startConfiguredPluginPreparation;
    private waitForConfiguredPluginReconcile;
    private runConfiguredPluginPreparation;
    private prepareRuntimeDesiredState;
    /**
     * Wait for the runtime projection currently being applied.
     *
     * Startup refreshes are launched before the HTTP server begins listening,
     * because stdio plugin MCP servers need that HTTP endpoint in their child
     * process environment. Agent entry points join this barrier before using
     * Product/Agent state, while health/readiness endpoints remain available.
     * The tail intentionally absorbs refresh failures: startup plugin failures
     * degrade with the warning emitted below instead of making the CLI unusable.
     */
    waitForRefreshSettled(): Promise<void>;
    waitForBackgroundWorkToSettle(): Promise<void>;
    /**
     * Hold a turn until the plugins that build the system prompt are live.
     *
     * WorkBuddy's persona is not passed in as an argument: it is assembled by
     * `composePluginAgent` from templates that the `workbuddy-builtin` plugins
     * contribute. Startup and prewarm activation deliberately publish a
     * cache-first active snapshot and hand installation to the background pass
     * (see `refresh`), so on a cold plugin cache the first model request can be
     * built while that snapshot is still empty. Compose then finds no root
     * plugin, returns the agent untouched, and the turn silently runs on the
     * CLI's generic persona.
     *
     * `waitForRefreshSettled` cannot cover this: it only awaits the projection
     * tail, and the background pass is intentionally not on that tail.
     *
     * The wait is deliberately narrow and fails open. It tracks only compose
     * plugins, never the remote marketplaces installed alongside them, and a
     * timeout emits a warning plus telemetry rather than blocking the user.
     */
    waitForComposePluginsReady(): Promise<void>;
    private runComposePluginsGate;
    protected getComposePluginReadyTimeoutMs(): number;
    private reportComposeGate;
    /**
     * Block until every expected compose plugin is committed to the installed
     * registry, or the deadline passes. Returns the plugins still missing.
     */
    private awaitComposePluginInstallation;
    /** Resolves true on the next PluginManager mutation, false on timeout. */
    private waitForPluginManagerChange;
    /** Of `expected`, the ids absent from the committed active snapshot. */
    private findUnprojectedPlugins;
    /** Ids of enabled plugins materialized from the committed registry. */
    private collectReadyInstalledPluginIds;
    private findUninstalledComposePlugins;
    /**
     * Compose plugins this session is supposed to end up with.
     *
     * Two sources, because neither alone covers every host.
     *
     * WorkBuddy Desktop declares every compose plugin with `autoEnable: false`
     * (they are pre-materialized, then picked per session), so the product
     * declarations contribute nothing here and `enabledPlugins` carries the
     * whole set - the daemon passes it through `--settings` at activation,
     * before the first turn. A host that instead relies on product-declared
     * first-run defaults has the opposite shape: the declaration is the only
     * standing truth, because settings gain those ids only *after* the install
     * writes them, which is exactly the moment this gate exists for.
     *
     * Settings still wins when it explicitly disables a declared plugin, and it
     * adds anything a host enabled directly.
     */
    private readDesiredComposePluginIds;
    /**
     * Enabled, not-yet-installed plugins from a local directory marketplace
     * whose source declares `settings.agent` (in `plugin.json` or the
     * standalone `settings.json` agent-init writes). These are the expert
     * personas the first turn must wait for. Directory sources only: reading
     * them is a local stat/read, never a download.
     */
    private findUninstalledLocalAgentPlugins;
    /**
     * Effective `enabledPlugins` under the same scope precedence PluginManager
     * applies, so the gate never waits for a plugin the settings would not
     * enable.
     */
    private readEnabledPluginSettings;
    /**
     * Run a Resource-side Plugin operation on the same queue as runtime
     * refreshes. The operation may materialize immutable Plugin cache entries,
     * so treating it as a plain read would allow refreshActivePlugins() to
     * observe only part of a dependency closure.
     */
    runWithPluginState<T>(operation: () => Promise<T>): Promise<T>;
    refresh(reason: PluginRuntimeRefreshReason, options?: PluginRuntimeRefreshOptions): Promise<PluginRuntimeRefreshResult>;
}
//# sourceMappingURL=plugin-runtime-refresh-service.d.ts.map