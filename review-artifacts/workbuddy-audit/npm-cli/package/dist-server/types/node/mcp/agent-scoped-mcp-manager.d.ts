import { Logger } from '@celljs/core';
import { type Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import type { AgentMcpServerSpec } from '@genie/product';
import { type ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
import { SettingsManager } from '../settings';
import { AgentScopedMcpManager, McpConfig, McpManager, McpScope, MCPServer, McpServerManager, McpTransportManager } from './mcp-protocol';
export declare class AgentScopedMcpManagerImpl implements AgentScopedMcpManager {
    /**
     * Do not route these configs through McpConfigManager/McpManager. Those are
     * process-global registries; using them would make a subagent's inline MCP
     * visible to the parent and sibling agents.
     */
    protected readonly mcpManager: McpManager;
    protected readonly mcpServerManager: McpServerManager;
    protected readonly sessionManager: SessionManager;
    protected readonly transportManager: McpTransportManager;
    protected readonly sandboxLifecycle?: ISandboxCLILifecycle;
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    private readonly states;
    private readonly toolsChanged;
    readonly onDidChangeTools: import("@celljs/core").Event<void>;
    private isProjectInlineAllowed;
    setupForSubAgent(input: {
        session: Session;
        agentName: string;
        agentSource?: string;
        isFlagSettingsAgent?: boolean;
        specs: AgentMcpServerSpec[];
        strictMcpConfig?: boolean;
        deferEnvironmentServers?: boolean;
        scope?: McpScope;
    }): Promise<void>;
    startEnvironmentServers(session: Session, signal?: AbortSignal): Promise<void>;
    hasEnvironmentServers(session: Session | undefined): boolean;
    private environmentLane;
    private connectEnvironmentServers;
    private connectEnvironmentServer;
    private closeEnvironmentServer;
    private closeEnvironmentLane;
    private connectedEnvironmentServers;
    getServers(sessionId: string): MCPServer[];
    getInlineServers(sessionId: string): Array<{
        server: MCPServer;
        config: McpConfig;
        scope?: McpScope;
    }>;
    getMergedServers(session: Session | undefined, globalServers: MCPServer[]): MCPServer[];
    /** Borrow live ancestors through SessionManager; never restore a session or own its clients here. */
    private visibleStates;
    private mergeServers;
    cleanup(sessionId: string): Promise<void>;
    private readInlineSpec;
    private hasBareNameConfig;
    private normalizeConfig;
}
