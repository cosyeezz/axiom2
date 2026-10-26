import { Logger } from '@genie/telemetry';
import { AgentManager, AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
/**
 * Prepends the main agent's `initialPrompt` (from `.md` frontmatter or product
 * config) to the FIRST user turn of a main session — Claude Code parity for
 * running a whole session as an agent via `--agent <name>` / `settings.agent`.
 *
 * Scope guards (all must hold, otherwise no-op):
 * - main session only: sub-agent sessions (`meta.parentSessionId`) and teammate
 *   sessions (`meta.teamContext`) get their task prompt from the Agent tool /
 *   mailbox, not from a user's first message;
 * - first turn only: `session.history` is still empty at this priority (the
 *   History interceptor appends input at 1400, after us), so a non-empty
 *   history means an ongoing or resumed conversation — never re-inject;
 * - real user runs only: queued (`skipRun`), internal replays
 *   (`skipAddHistory`), and token-calculation probes are skipped.
 */
export declare class InitialPromptAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly agentManager: AgentManager;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * The effective main agent is the settings/--agent override when the run
     * comes in under the default agent name (same mapping as the telemetry
     * interceptor's session.agentName resolution).
     */
    private resolveInitialPrompt;
}
