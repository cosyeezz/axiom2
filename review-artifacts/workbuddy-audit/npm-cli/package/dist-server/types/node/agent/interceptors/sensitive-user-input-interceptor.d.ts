import { AgentRunInterceptor, AgentRunInterceptorPriority, type AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
import { type SensitiveUserInputReview as SensitiveUserInputReviewInterface } from '../../sensitive-content/sensitive-content-protocol';
export declare class SensitiveUserInputAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly sensitiveUserInputReview?: SensitiveUserInputReviewInterface;
    intercept(request: AgentRunRequest): Promise<void>;
}
