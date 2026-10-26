import { type Session } from '../../../vendor/cbc-core/node/index.js';
import { type ContentReviewDeps, type ContentReviewResult } from './content-review';
/** 工具结果注入检测实现；轮次预算与并发额度归属于单个实例。 */
export declare class ContentReviewEngine {
    private readonly deps;
    private readonly turns;
    private activeReviews;
    private readonly waitingReviews;
    constructor(deps: ContentReviewDeps);
    private detectBounded;
    review(session: Session, toolCallId: string, content: unknown, taskText: string, toolName: string): Promise<ContentReviewResult>;
    private detect;
}
