import { Logger } from '@genie/telemetry';
import { MessageQueueManager } from '../../session/session-protocol';
import { SessionRunStateMachine } from '../../session/session-run-state-machine-protocol';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../agent-protocol';
export declare class SkipRunAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly stateMachine: SessionRunStateMachine;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class UserInputAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class MessageQueueAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly messageQueueManager: MessageQueueManager;
    protected readonly logger: Logger;
    protected readonly stateMachine: SessionRunStateMachine;
    intercept(request: AgentRunRequest): Promise<void>;
    private consumeQueueItems;
}
/**
 * 用户查询包裹拦截器
 *
 * 在管道末端对每条用户消息中的原始文本内容
 * 用 <user_query> XML 标签包裹，帮助模型区分用户实际查询和系统注入的上下文。
 */
export declare class UserQueryWrapperAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
    private wrapUserMessageContent;
}
//# sourceMappingURL=input-interceptors.d.ts.map