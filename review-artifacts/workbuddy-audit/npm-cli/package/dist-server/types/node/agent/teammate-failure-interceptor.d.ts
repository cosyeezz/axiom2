import { Logger } from '@genie/telemetry';
import type { TeammateFailureInfo } from '../agent-team/team-member';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
/**
 * Window within which a recorded teammate failure is still surfaced to the
 * team-lead's system prompt. Older failures are ignored so stale errors do
 * not keep re-polluting future turns.
 *
 * Kept in sync with `docs/workbuddy/fix/task-status-sync/issue-5-teammate-auth-failure.md` §4.3.
 */
export declare const TEAMMATE_FAILURE_TTL_MS: number;
/**
 * Lightweight shape used by `formatTeammateFailuresBlock` — exported for
 * unit tests that exercise the formatting logic without going through
 * CellJS DI + TeamMemberRegistry.
 */
export interface TeammateFailureEntry {
    name: string;
    lastFailure?: TeammateFailureInfo;
}
/**
 * Pure formatter: given a list of team members (each carrying an optional
 * `lastFailure`) and a `now` timestamp, return the markdown body of the
 * `<teammate-failures>` block, or undefined when there is nothing to report.
 *
 * Filters by TTL so stale failures older than {@link TEAMMATE_FAILURE_TTL_MS}
 * are dropped.
 *
 * This function is the single source of truth for the block's contents so
 * behavior can be verified by unit tests independent of CellJS.
 */
export declare function formatTeammateFailuresBlock(members: ReadonlyArray<TeammateFailureEntry>, now?: number): string | undefined;
/**
 * Issue 5 · `TeammateFailureInterceptor`
 *
 * When the team-lead starts a new turn, inspect the TeamMemberRegistry for
 * any teammates whose most recent AgentTask failed (non-silentAbort). For
 * each such teammate within the TTL window, emit a `<teammate-failures>`
 * `<system-reminder>` block so the main agent knows NOT to fabricate a
 * success report and instead surfaces the failure to the user.
 *
 * Non-teammate / non-team-lead sessions are left untouched — `intercept`
 * returns early.
 *
 * Design notes:
 * - Runs at priority 1160 (between TeamContext=1175 and MemoryContext=1150)
 *   so the failure notice follows the team-lead instructions but precedes
 *   memory recall, reflecting its higher importance.
 * - Reads failures from `TeamMember.lastFailure` which is populated by
 *   `AgentTask.execute()`'s failed branch (see agent-task.ts
 *   `recordTeammateFailure`). Error strings are already sanitized at write
 *   time (credentials / URL query stripped, <=500 chars).
 * - Deduplicates within a prompt by checking for `TEAMMATE_FAILURES_MARKER`
 *   in the last user message — mirrors the pattern used by
 *   `TeamContextInterceptor.shouldInjectTeamPrompt`.
 */
export declare class TeammateFailureInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    /**
     * Check whether the input already contains a `<teammate-failures>` block
     * from a prior interceptor pass (e.g. resumed prompt). Deduplication
     * mirrors `TeamContextInterceptor.shouldInjectTeamPrompt`.
     */
    private hasExistingFailureMarker;
}
