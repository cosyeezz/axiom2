/**
 * Scope-scoped hook registry implementation.
 *
 * Acts as the 5th hook source in `HookManager.getHooks`, alongside:
 *   1. settings.json hooks
 *   2. plugins hooks.json
 *   3. @Component(Hook) internal hooks
 *   4. SdkHooksManager
 *
 * Used by agent-task / skill-tool (fork path) to register frontmatter hooks
 * with a scope (typically a subagent session id) that auto-cleans when the
 * scope ends.
 *
 * Aligns with Claude Code's `addSessionHook` / `removeSessionHook` +
 * `registerFrontmatterHooks`.
 */
import { Logger } from '@genie/telemetry';
import { HookConfig, ScopedHookRegisterOptions, ScopedHookRegistry } from './hook-protocol';
import { HookEvent } from '../../vendor/cbc-shared/node/index.js';
export declare class ScopedHookRegistryImpl implements ScopedHookRegistry {
    protected readonly logger: Logger;
    /** scopeId → ScopeRecord */
    private readonly scopes;
    register(scopeId: string, hooks: Record<string, HookConfig[] | undefined>, options: ScopedHookRegisterOptions): void;
    unregister(scopeId: string): void;
    getHooks(event: HookEvent): HookConfig[];
    hasScope(scopeId: string): boolean;
}
