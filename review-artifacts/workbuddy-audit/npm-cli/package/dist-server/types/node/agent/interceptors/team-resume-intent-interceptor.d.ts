import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest, type AgentRunScope as IAgentRunScope } from '../../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
/**
 * Tags fresh, trusted human input before queue arbitration. The tag is carried
 * with queued/merged user input and stripped before History, so replayed history
 * cannot forge a human resume turn.
 */
export declare class HumanInputProvenanceAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    intercept(request: AgentRunRequest): Promise<void>;
}
/**
 * Rehydrates interrupted team runtime at the model-run boundary, after queued
 * user input has been selected and before the human marker is consumed.
 */
export declare class TeamRuntimeResumeAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
}
/**
 * Resolves the human-resume capability after MessageQueue has decided which
 * input belongs to this actual model run, then strips the marker before History.
 */
export declare class TeamResumeIntentAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly agentRunScope?: IAgentRunScope;
    protected readonly logger: Logger;
    intercept(request: AgentRunRequest): Promise<void>;
}
