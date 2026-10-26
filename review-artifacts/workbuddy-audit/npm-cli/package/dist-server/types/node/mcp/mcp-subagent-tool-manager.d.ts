import { McpSubagentToolManager, type McpToolAllowOptions } from './mcp-protocol';
export declare class McpSubagentToolManagerImpl implements McpSubagentToolManager {
    private readonly processTools;
    private readonly queryTools;
    private get allowedToolsMap();
    register(agentName: string, mcpTools: string[]): void;
    getTools(agentName: string): string[] | undefined;
    isToolAllowed(agentName: string, toolName: string, options?: McpToolAllowOptions): boolean;
    unregister(agentName: string): void;
    clear(): void;
}
