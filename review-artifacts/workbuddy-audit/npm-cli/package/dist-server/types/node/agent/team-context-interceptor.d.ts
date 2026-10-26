import { PromptManager } from '@genie/prompts';
import { Logger } from '@genie/telemetry';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
/**
 * TeamContextInterceptor injects the team communication prompt into sessions.
 *
 * Two modes:
 * 1. Teammate sessions (session.meta.teamContext) — injects `team-sys-prompt` template
 * 2. Main agent sessions in a team (formal or auto) — injects a team-lead prompt
 *    listing current teammates and how to communicate with them via SendMessage
 *
 * Priority 1175: runs after SystemReminderContext (1200) and before MemoryContext (1150),
 * so the team prompt is injected alongside other system reminders.
 */
export declare class TeamContextInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly promptManager: PromptManager;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * Inject team-sys-prompt template for teammate sessions.
     */
    private injectTeammatePrompt;
    /**
     * Inject a prompt for the main agent (team-lead) when in a team (formal or auto).
     * Uses the `team-lead-prompt` template which includes teammate listing,
     * communication rules, worker prompt writing guides, and task workflow.
     */
    private injectTeamLeadPrompt;
    /**
     * Decide whether to (re-)inject the team system reminder this turn.
     *
     * Returns true when any of the following holds:
     *   - First user message in the session
     *   - Resumed session (history not yet replayed)
     *   - The marker text is missing from history (e.g. context was compacted)
     *   - The current roster differs from the last roster we injected
     *     (so newly-spawned teammates show up without waiting for compaction)
     */
    private shouldInjectTeamPrompt;
    private recordInjectedRoster;
}
