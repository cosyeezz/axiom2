import { type AgentManager, type Session, type SessionManager } from '../../vendor/cbc-core/node/index.js';
export interface ModsUsageDependencies {
    getSession(): Session;
    getAgentManager(): AgentManager;
    getSessionManager(): SessionManager;
}
/**
 * `$.session.usage()`: the status line's `context_window` figures (official
 * `SessionUsage`). `tokens` is the input the last response was answered over,
 * `window` the session's effective context budget, `percent` a whole number.
 * A figure the host does not have is left out, never zeroed; no breakdown is
 * computed, so the call sends no token-count request.
 */
export declare function createModsUsageBinding(deps: ModsUsageDependencies): (args?: Record<string, unknown>) => Promise<unknown>;
