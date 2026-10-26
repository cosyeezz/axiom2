import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
export type ContextBudgetPreparation = {
    status: 'fits';
    history: AgentInputItem[];
    estimatedTokens: number;
} | {
    status: 'unknown';
    history: AgentInputItem[];
    estimatedTokens: number;
} | {
    status: 'rejected';
    history: AgentInputItem[];
    estimatedTokens: number;
    reason: 'protected_tail_too_large' | 'over_budget';
};
export interface ContextBudgetPrepareInput {
    history: readonly AgentInputItem[];
    protectedTail: readonly AgentInputItem[];
    /** Available prompt tokens after reserving the target model's output. */
    targetInputTokens?: number;
    /**
     * Last provider-reported prompt size for the current conversation.
     * Prefer this over a local history estimate; do not pass it after /compact,
     * because latest usage still points at the pre-compact request.
     */
    measuredTokens?: number;
}
/**
 * Estimates whether history plus a protected tail fit a model input budget.
 * Does not own a Session, persist history, or compress.
 */
export declare class ContextBudgetPreparer {
    /**
     * Last API `inputTokens`, plus trailing tool results that arrived after that
     * response. Matches PreMessageCompactInterceptor's overflow signal.
     */
    static measureReportedTokens(session: Pick<Session, 'history'>): number | undefined;
    static prepare(input: ContextBudgetPrepareInput): ContextBudgetPreparation;
}
//# sourceMappingURL=context-budget-preparer.d.ts.map