import { Provider } from '@celljs/core';
import { type HookInput, type InternalHookContext } from '../../vendor/cbc-core/node/index.js';
import { PluginManager } from '../../vendor/cbc-plugins/node/index.js';
import { HookEvent, HookExecutionOptions, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { SdkHooksManager } from '../control-signal/control-signal-protocol';
import { DebugService } from '../debug';
import { EndpointProvider } from '../loopback/server-protocol';
import { type SensitiveToolEgressGuard as SensitiveToolEgressGuardInterface } from '../sensitive-content';
import { SettingsManager } from '../settings';
import { Hook, HookConfig, HookExecutor, HookInputProcessor, HookManager, HttpHookDefinition, PromptHookService, ScopedHookRegistry } from './hook-protocol';
/**
 * Implementation of HookManager
 *
 * Manages hook configurations and orchestrates hook execution
 */
export declare class HookManagerImpl implements HookManager {
    protected readonly settingsManager: SettingsManager;
    protected readonly hookExecutor: HookExecutor;
    protected readonly promptHookService: PromptHookService;
    protected readonly logger: Logger;
    protected readonly debugService: DebugService;
    protected readonly pluginManager: PluginManager;
    protected readonly sdkHooksManager: SdkHooksManager;
    protected readonly endpointProvider: EndpointProvider;
    protected readonly productManager: ProductManager;
    protected readonly sensitiveToolEgressGuard?: SensitiveToolEgressGuardInterface;
    protected readonly scopedHookRegistry: ScopedHookRegistry;
    protected readonly hookProvider: Provider<Hook>;
    protected readonly hookInputProcessorProvider: Provider<HookInputProcessor>;
    /**
     * Hooks that have successfully run once (with `once: true`). Stored in-memory
     * only — settings.json is not rewritten.
     */
    private readonly onceFired;
    private runtimeSecurityHookLoader;
    /**
     * Execute all matching hooks for an event (unified: local + SDK)
     *
     * 统一执行模型：
     * 1. 收集所有 hooks (local configs + SDK matchers)
     * 2. 展开为 hook tasks
     * 3. 并行执行所有 tasks
     * 4. 聚合结果 (any deny = deny)
     */
    executeHooks(event: HookEvent, input: HookInput, options?: HookExecutionOptions, internalContext?: InternalHookContext): Promise<HookExecutionResult>;
    private observeHookExecute;
    private resolveHookObservationStatus;
    /** 既有 shell hook 的执行（本方法是改造前 `executeHooks` 的原样内容）。 */
    private executeShellHooks;
    /**
     * Get matching internal hooks for an event, sorted by priority
     */
    private getMatchingInternalHooks;
    /**
     * Check if internal hook matcher matches the value
     */
    private matchesInternalHookMatcher;
    /**
     * Execute a single internal hook
     */
    private executeInternalHook;
    /**
     * Execute a single SDK hook callback
     */
    private executeSdkHook;
    /**
     * Convert SDK HookOutput to HookExecutionResult
     */
    private convertSdkOutputToResult;
    /**
     * Get match value based on event type
     */
    private getMatchValue;
    /**
     * Check if SDK matcher matches the value
     */
    private matchesSdkMatcher;
    /**
     * Aggregate results from all hooks (any deny = deny)
     */
    private aggregateSettledResults;
    /**
     * Merge multiple continue messages into one
     */
    private mergeMessages;
    /**
     * Convert local HookInput to SDK HookInput format
     * @param event Hook event type
     * @param input Local hook input
     * @param cliHookOutput CLI hook aggregated output to pass through to SDK hooks
     */
    private convertToSdkInput;
    /**
     * Execute a single local hook (command or prompt type)
     */
    private executeLocalHook;
    /**
     * Execute a prompt type hook using LLM evaluation
     */
    private executePromptHook;
    /**
     * Execute a command type hook using shell execution
     */
    private executeCommandHook;
    /**
     * Deduplicate hooks by their unique identifier.
     *
     * Aligned with Claude Code's `hookDedupKey` (CC `utils/hooks.ts:1453`):
     *
     *     key = `${sourceId ?? pluginRoot ?? ''}\0${type}\0${payload}`
     *
     * Where `payload` carries the behaviour-defining fields per type:
     *   - command: `${shell ?? 'bash'}\0${command}\0${if ?? ''}`
     *   - prompt:  `${prompt}\0${if ?? ''}`
     *   - agent:   `${prompt}\0${if ?? ''}`
     *   - http:    `${url}\0${method ?? 'POST'}\0${if ?? ''}`
     *
     * Source-namespacing matters:
     *   - settings hooks (user / project / local) carry no source id, so the
     *     same command across scopes collapses to one — the original intent
     *     of dedup (Issue #42872 problem 2).
     *   - plugin / frontmatter-agent / skill hooks each carry their own
     *     sourceId, so two distinct plugins or two distinct sub-agents that
     *     happen to define the same command each fire once (CC gh-29724).
     *
     * `timeout` is intentionally NOT part of the key — defining the same
     * command twice with different timeouts is a config conflict, not two
     * distinct hooks; first occurrence wins.
     */
    private deduplicateHooks;
    /**
     * Prepare environment variables for hook execution
     * Claude Code spec: CLAUDE_PROJECT_DIR
     */
    protected prepareEnvironment(event: HookEvent, input: HookInput): Promise<Record<string, string>>;
    /**
     * Asks the shell environment policy once for this event. An embedded
     * execution such as a configuration change keeps the environment it
     * captured, and an event without a session asks nothing. SessionEnd, and an
     * event whose run has already ended, asks with a deadline of its own rather
     * than the aborted run signal.
     */
    private askEventEnvironment;
    /**
     * Run all registered HookInputProcessors in priority order.
     */
    private runInputProcessors;
    /**
     * Check if hooks are configured for an event
     */
    hasHooks(event: HookEvent, matchValue?: string): Promise<boolean>;
    /**
     * Get all configured hooks for an event
     */
    getHooks(event: HookEvent): Promise<HookConfig[]>;
    /**
     * Load hooks from installed plugins
     * @param event - The hook event to load hooks for
     * @returns Array of hook configs from plugins
     */
    private loadHooksFromPlugins;
    /**
     * Find hooks that match the given value
     *
     * @param configs - Hook configurations
     * @param matchValue - Value to match against (tool_name, source, reason, trigger, etc.)
     * @returns Array of matching hook definitions
     */
    private findMatchingHooks;
    /**
     * Claude Code `if` permission-rule filtering. Applied after matcher-level
     * filtering: each hook with a non-empty `if` is dropped when the tool
     * context doesn't satisfy the rule.
     */
    private filterHooksByIfRule;
    /**
     * Execute an HTTP hook — POST the HookInput JSON to `hook.url`, treat the
     * response body as a HookOutput JSON. headers support `$VAR` / `${VAR}`
     * interpolation restricted to `allowedEnvVars` whitelist. Errors and
     * non-2xx responses are reported as non-blocking warnings (allowed=true).
     */
    /** An embedded execution may supply its environment and scoped HTTP transport. */
    protected getEnvironment(): NodeJS.ProcessEnv;
    protected request(url: string, options: RequestInit): Promise<Response>;
    protected executeHttpHook(hook: HttpHookDefinition, input: HookInput, _event?: HookEvent, _options?: HookExecutionOptions): Promise<HookExecutionResult>;
    private reviewHttpHookEgress;
    private resolveHttpHookDestination;
}
