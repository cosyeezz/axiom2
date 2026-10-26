import { AgentRunInterceptor, type AgentRunRequest } from '../../vendor/cbc-core/node/index.js';
/** 最后一条用户消息的正文。唤醒 / isMeta 不算新用户话，避免覆盖 planner follow-up。 */
export declare function extractUserText(input: unknown): string;
export declare class MultitaskCoordinatorInterceptor implements AgentRunInterceptor {
    priority: number;
    intercept(request: AgentRunRequest): Promise<void>;
}
