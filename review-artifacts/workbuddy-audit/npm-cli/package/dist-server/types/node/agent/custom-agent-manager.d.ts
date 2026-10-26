import { Logger } from '@celljs/core';
import { ProductManager } from '@genie/product';
import { ConsoleManager } from '../console';
import { type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { AgentService, CreateCustomAgentResult, CustomAgent, CustomAgentManager, CustomAgentScope } from '../../vendor/cbc-core/node/index.js';
import { CustomAgentPathRegistry } from './custom-agent-path-registry';
export declare class CustomAgentManagerImpl implements CustomAgentManager {
    protected readonly productManager: ProductManager;
    protected readonly sessionManager: SessionManager;
    protected readonly agentService: AgentService;
    protected readonly logger: Logger;
    protected readonly consoleManager: ConsoleManager;
    protected readonly customAgentPathRegistry?: CustomAgentPathRegistry;
    protected customAgents: CustomAgent[];
    init(): void;
    /**
     * Build the model catalog exposed to the one-time agent generator.
     * Keep it derived from the current ProductConfiguration (the same filtered
     * source used by `/model`) and omit endpoint/key fields.
     */
    private getAiModelChoices;
    /**
     * Normalize the model selected by the generator. Exact IDs are preferred,
     * but display names and aliases are accepted for natural-language output.
     * Unknown/disabled models fail closed to parent-model inheritance.
     */
    private resolveAiModel;
    private buildAiModelPrompt;
    private agentSettingsWithAI;
    private static readonly AI_TOOLS_FALLBACK;
    private resolveAiTools;
    private createAgentMd;
    private loadCustomAgents;
    private getSavePath;
    createByAI(session: Session, description: string, scope: CustomAgentScope): Promise<CreateCustomAgentResult>;
    delete(agentName: string): Promise<void>;
    get(agentName: string): CustomAgent | undefined;
    getAll(): CustomAgent[];
    resolveSettingsPath(agent: CustomAgent): Promise<string>;
    openSettings(agent: CustomAgent, options?: {
        allowTerminalEditor?: boolean;
    }): Promise<void>;
}
