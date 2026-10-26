import { Logger } from '@celljs/core';
import { Agent, ProductConfiguration, ProductProvider } from '@genie/product';
import { FileSystem } from '@genie/runtime';
import { CustomAgentPathRegistry } from '../agent/custom-agent-path-registry';
export declare const MAX_CUSTOM_AGENT_FILES_PER_SOURCE = 2048;
export declare const MAX_CUSTOM_AGENT_FILE_BYTES: number;
export declare const MAX_CUSTOM_AGENT_DISCOVERY_BYTES_PER_SOURCE: number;
export declare const MAX_CUSTOM_AGENT_SCAN_ENTRIES_PER_SOURCE = 4096;
export declare const MAX_CUSTOM_AGENT_DISCOVERY_ENTRY_BYTES: number;
export type CustomAgentSource = 'project' | 'user';
export interface CustomAgentSummary {
    name: string;
    description: string;
    path: string;
    source: CustomAgentSource;
    model?: string;
    tools?: string[];
    color?: string;
}
export interface CustomAgentScanError {
    path: string;
    message: string;
}
export interface CustomAgentListDetailedResult {
    agents: CustomAgentSummary[];
    errors: CustomAgentScanError[];
}
export interface CustomAgentDiscoveryOptions {
    forceReload?: boolean;
    signal?: AbortSignal;
}
export declare const CustomAgentDiscoveryService: unique symbol;
export interface CustomAgentDiscoveryService {
    listAgentsDetailed(cwd: string, options?: CustomAgentDiscoveryOptions): Promise<CustomAgentListDetailedResult>;
}
/**
 * Custom agents product provider that reads markdown files from .codebuddy/agents directories
 * and converts them to product agent format.
 */
export declare class CustomAgentsProductProvider implements ProductProvider, CustomAgentDiscoveryService {
    scope: "runtime";
    priority: number;
    protected readonly fs?: FileSystem;
    protected readonly logger: Logger;
    protected readonly customAgentPathRegistry?: CustomAgentPathRegistry;
    provide(): Promise<ProductConfiguration>;
    private loadCustomAgents;
    /** Served sessions resolve project and user definitions through their mounted filesystem. */
    scanWorkspace(cwd: string): Promise<Agent[]>;
    private pathExists;
    listAgentsDetailed(cwd: string, options?: CustomAgentDiscoveryOptions): Promise<CustomAgentListDetailedResult>;
    /** Full definitions for host assembly, using the same bounded parser as agent/list. */
    loadAgents(cwd: string, options?: CustomAgentDiscoveryOptions): Promise<Agent[]>;
    private discoverAgents;
    /**
     * Parse Claude-compatible `mcpServers` frontmatter without touching runtime MCP.
     * Loading a markdown agent must stay cheap and side-effect free: no server
     * connection, no config writes, no validation against the global MCP pool here.
     */
    private parseMcpServers;
    private scanAgentsDirectory;
    /** Apply the same dataFs file-link boundary to management and runtime reads. */
    private inspectAgentFile;
    private scanAgentsDirectoryDetailed;
    private parseAgentFile;
    private generateSourceLabel;
}
