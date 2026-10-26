import { type Session } from '../../../vendor/cbc-core/node/index.js';
import type { ToolRiskReviewHostFacts } from '@genie/product';
import type { ToolActionProjection } from './protocol';
export declare const REVIEW_CONTEXT_BUDGETS: {
    readonly trustedUserIntent: 4000;
    readonly priorUserContext: 1000;
    readonly projectInstructions: 2000;
    readonly projection: 8000;
    readonly recentToolCallTurns: 1000;
    readonly total: 16000;
};
export type ReviewContextTrust = 'trusted_user_intent' | 'prior_user_context' | 'background_only' | 'action_to_review' | 'action_history_only';
export interface LengthPrefixedReviewContextBlock {
    trust: ReviewContextTrust;
    codePoints: number;
    content: string;
}
export interface ToolRiskReviewContext {
    hostFacts?: ToolRiskReviewHostFacts;
    trustedUserIntent?: LengthPrefixedReviewContextBlock;
    priorUserContext?: LengthPrefixedReviewContextBlock;
    projectInstructions?: LengthPrefixedReviewContextBlock;
    projection: LengthPrefixedReviewContextBlock;
    recentToolCallTurns: {
        trust: 'action_history_only';
        codePoints: number;
        items: LengthPrefixedReviewContextBlock[];
    };
    totalCodePoints: number;
}
export interface BuildToolRiskReviewContextInput {
    session: Pick<Session, 'history'>;
    hostFacts?: ToolRiskReviewHostFacts;
    projectInstructions?: string;
    projection: ToolActionProjection;
    recentToolCallTurns: readonly ToolActionProjection[];
}
export declare function truncateCodePoints(value: string, maxCodePoints: number): string;
export declare function extractDirectUserContext(session: Pick<Session, 'history'>): {
    trustedUserIntent: string;
    priorUserContext: string;
};
