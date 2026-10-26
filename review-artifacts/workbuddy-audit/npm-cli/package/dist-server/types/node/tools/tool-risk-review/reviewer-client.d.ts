import { type AgentService as IAgentService, type ReviewerRecovery, type Session } from '../../../vendor/cbc-core/node/index.js';
import { type ReviewerAction, type ReviewUnavailableReason } from './protocol';
import type { ToolRiskReviewContext } from './review-context';
export declare const TOOL_RISK_REVIEW_TIMEOUT_MS = 60000;
type ToolRiskReviewRuntime = typeof import('./review-runtime');
/** 加载审查运行时；成功结果进程内缓存，失败抛出原始错误且不缓存。 */
export declare function loadToolRiskReviewRuntime(): Promise<ToolRiskReviewRuntime>;
export interface ToolRiskReviewClientInput {
    context: ToolRiskReviewContext;
    callerSession?: Session;
    customRules?: readonly string[];
    summaryLanguage?: 'zh-CN' | 'en';
    signal?: AbortSignal;
}
export type ToolRiskReviewClientResult = ({
    status: 'reviewed';
    action: ReviewerAction;
} | {
    status: 'unavailable';
    reason: ReviewUnavailableReason;
}) & {
    totalTokens?: number;
    credit?: number;
    recovery?: ReviewerRecovery;
    requestAttempted?: boolean;
};
export declare const ToolRiskReviewClient: unique symbol;
export interface ToolRiskReviewClient {
    review(input: ToolRiskReviewClientInput): Promise<ToolRiskReviewClientResult>;
}
export declare class ToolRiskReviewClientImpl implements ToolRiskReviewClient {
    private resolvedAgentService?;
    protected get agentService(): IAgentService;
    protected set agentService(value: IAgentService);
    review(input: ToolRiskReviewClientInput): Promise<ToolRiskReviewClientResult>;
}
export {};
