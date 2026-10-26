import { SettingsManager } from '../../settings';
import { AgentRunInterceptor, AgentRunInterceptorPriority, AgentRunRequest } from '../../../vendor/cbc-core/node/index.js';
export declare class EnvAgentRunInterceptor implements AgentRunInterceptor {
    priority: AgentRunInterceptorPriority;
    protected readonly settingsManager: SettingsManager;
    intercept(_request: AgentRunRequest): Promise<void>;
}
