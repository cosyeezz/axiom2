import type { SecurityReviewFailureReason } from '@genie/telemetry';
export declare class ReviewerCircuitBreaker {
    private readonly now;
    failureReason?: SecurityReviewFailureReason;
    private consecutiveFailures;
    private openUntil;
    private halfOpenProbeInFlight;
    constructor(now?: () => number);
    tryAcquire(): boolean;
    recordSuccess(): void;
    recordUnavailable(reason: SecurityReviewFailureReason): void;
}
export declare class ReviewerModelError extends Error {
    readonly failureReason: SecurityReviewFailureReason;
    readonly circuitFailureReason?: SecurityReviewFailureReason | undefined;
    constructor(failureReason: SecurityReviewFailureReason, circuitFailureReason?: SecurityReviewFailureReason | undefined);
}
export declare function classifyReviewerError(error: unknown, timedOut?: boolean, cancelled?: boolean): SecurityReviewFailureReason;
type ReviewerAbortReason = Extract<SecurityReviewFailureReason, 'timeout' | 'cancelled'>;
/** 中止 reason 即失败原因，模型调用上报经 {@link reviewerAbortReason} 读回以区分超时与取消。 */
export declare function abortReviewer(controller: AbortController, timedOut: boolean): void;
export declare function reviewerAbortReason(signal: AbortSignal): ReviewerAbortReason;
/** 输出被截断无法得到完整结论，按输出不合规处理；网关两种 content filter 拼写都会出现。 */
export declare function classifyReviewerFinishReason(finishReason: string | undefined): Extract<SecurityReviewFailureReason, 'schema_invalid' | 'content_filter'> | undefined;
export declare function canRetryReviewer(reason: SecurityReviewFailureReason): boolean;
export {};
//# sourceMappingURL=reviewer-recovery.d.ts.map