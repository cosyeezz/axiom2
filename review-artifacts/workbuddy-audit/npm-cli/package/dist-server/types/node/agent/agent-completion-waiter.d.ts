/**
 * Agent Completion Waiter Implementation
 *
 * Provides a centralized way to manage completion promises for agent sessions.
 * This replaces scattered deferred promise checks throughout the codebase.
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { AgentCompletionWaiter } from '../../vendor/cbc-core/node/index.js';
export declare class AgentCompletionWaiterImpl implements AgentCompletionWaiter {
    /**
     * WeakMap to store completion promises per session
     * Using WeakMap ensures automatic cleanup when session is garbage collected
     */
    private completionPromises;
    /**
     * Wait for all registered completion promises for a session
     */
    waitForCompletion(session: Session): Promise<void>;
    /**
     * Register a completion promise for a session
     * Multiple promises can be registered and all will be awaited
     */
    registerCompletion(session: Session, promise: Promise<void>): void;
    /**
     * Clear all completion promises for a session
     */
    clearCompletion(session: Session): void;
}
