import { Logger } from '@genie/telemetry';
import { SessionManager, SessionStore } from '../../session/session-protocol';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../agent-protocol';
export declare class ProviderDataAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class HistoryAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly sessionManager: SessionManager;
    protected readonly sessionStore: SessionStore;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
}
export declare class MessageReorganizeAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
}
//# sourceMappingURL=history-interceptors.d.ts.map