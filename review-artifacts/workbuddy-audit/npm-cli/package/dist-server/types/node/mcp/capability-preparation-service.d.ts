import { Logger } from '@celljs/core';
import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type CapabilityPreparationService as ICapabilityPreparationService } from './capability-preparation-protocol';
import { type AgentScopedMcpManager as IAgentScopedMcpManager, type McpServerManager as IMcpServerManager } from './mcp-protocol';
/**
 * Moves stable MCP discovery and session Agent-view construction ahead of the
 * first prompt. MCPServer caches only the pre-toolFilter catalog; permissions
 * and dynamic enabled checks remain owned by the SDK on every run.
 */
export declare class CapabilityPreparationServiceImpl implements ICapabilityPreparationService {
    protected readonly mcpServerManager: IMcpServerManager;
    protected readonly agentScopedMcpManager: IAgentScopedMcpManager;
    protected readonly logger: Logger;
    private processPreparation?;
    private sessionPreparations;
    startProcessPreparation(reason: string): void;
    startSessionPreparation(session: Session, reason: string): void;
    ensureSessionViewPrepared(session: Session): Promise<void>;
    invalidateSession(session: Session, reason: string): void;
    private prepareProcess;
    private settlePreparation;
    private prepareToolCatalogs;
    private collectServers;
    private waitForAgentConfiguration;
    private prepareAgentView;
    private observe;
}
