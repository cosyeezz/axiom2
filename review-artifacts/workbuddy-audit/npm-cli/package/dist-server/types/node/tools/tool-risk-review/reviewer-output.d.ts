import { type ReviewerAction } from './protocol';
export type ParsedReview = {
    status: 'reviewed';
    action: ReviewerAction;
} | {
    status: 'unavailable';
    reason: 'reviewer_unable' | 'schema_invalid';
};
export declare function parseReviewerOutput(rawOutput: string): ParsedReview;
