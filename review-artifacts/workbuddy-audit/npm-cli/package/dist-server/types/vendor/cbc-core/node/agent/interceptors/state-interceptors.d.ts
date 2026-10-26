import { SessionManager } from '../../session/session-protocol';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../agent-protocol';
export declare class StateAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly sessionManager: SessionManager;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class ContinueAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
//# sourceMappingURL=state-interceptors.d.ts.map