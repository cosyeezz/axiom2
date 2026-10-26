import { MCPServerSSE, MCPServerStdio, MCPServerStreamableHttp } from '@openai/agents';
import { MCPServerSSE as UnderlyingMCPServerSSE, MCPServerStdio as UnderlyingMCPServerStdio, MCPServerStreamableHttp as UnderlyingMCPServerStreamableHttp } from '@openai/agents-core/_shims';
import { ChannelManager } from '../channel';
import { CallToolResultContent, GetPromptResult, McpPrompt, McpResource, McpResourceTemplate, MCPServer, ReadResourceResult } from './mcp-protocol';
import { extractMcpCallSideband } from './mcp-tool-result-sideband';
/**
 * Register channel notification handlers on MCP Client session.
 * Wake-up pattern mirrors startTeamLeadInboxPolling() in team-create-tool.ts.
 *
 * 导出仅供单测驱动 channel 唤醒（模块内由 registerChannelIfApplicable 调用）。
 */
export declare function registerChannelNotificationHandlers(mcpSession: any, serverName: string, channelManager: ChannelManager): void;
/**
 * MCP progress callback and result-sideband contracts. The shared extractor is
 * used by every transport so wire metadata stays open while all local `__*`
 * fields are removed before serialization.
 */
export type { McpResultMetaSink, McpToolProgressCallback } from './mcp-tool-result-sideband';
/**
 * The MCP SDK's Client.callTool, when handed `RequestOptions.onprogress`, automatically:
 *   1. assigns a JSON-RPC messageId as `progressToken` in `_meta`
 *   2. registers the callback in its `_progressHandlers` map
 *   3. routes incoming `notifications/progress` by `progressToken` to the callback
 *   4. cleans up after the request settles
 */
declare const extractProgressCallback: typeof extractMcpCallSideband;
export { extractProgressCallback };
/**
 * Override MCPServerStdio to set stderr: 'ignore' when creating StdioClientTransport
 */
export declare class OverriddenUnderlyingMCPServerStdio extends UnderlyingMCPServerStdio implements MCPServer {
    private _name;
    private activeTransport;
    onToolsListChanged?: () => void;
    connect(signal?: AbortSignal): Promise<void>;
    close(): Promise<void>;
    /** Timestamp of the last listTools failure. Used to skip retries for a cooldown period. */
    private _lastListToolsFailure;
    /**
     * True when the last `listTools()` call took the degraded path (timeout /
     * transport error) and returned a fallback (cached or empty) instead of a
     * fresh authoritative list. Read by the defer-index path to distinguish
     * "server truly has 0 tools" from "we failed to fetch and made something up".
     * See issue #106255.
     */
    private _listToolsDegraded;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    listTools(): ReturnType<MCPServer['listTools']>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listPrompts(): Promise<McpPrompt[]>;
    /**
     * Capability declared at `initialize` and cached by the MCP client, so this
     * is a memory read that cannot time out — see MCPServer.supportsResources.
     */
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export declare class OverriddenMCPServerStdio extends MCPServerStdio implements MCPServer {
    protected underlying: OverriddenUnderlyingMCPServerStdio;
    constructor(params: ConstructorParameters<typeof MCPServerStdio>[0]);
    get onToolsListChanged(): (() => void) | undefined;
    set onToolsListChanged(callback: (() => void) | undefined);
    connect(signal?: AbortSignal): Promise<void>;
    listTools(): ReturnType<MCPServer['listTools']>;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    listPrompts(): Promise<McpPrompt[]>;
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export declare class OverriddenUnderlyingMCPServerSSE extends UnderlyingMCPServerSSE implements MCPServer {
    private _name;
    private transport;
    onToolsListChanged?: () => void;
    connect(): Promise<void>;
    /** Timestamp of the last listTools failure. Used to skip retries for a cooldown period. */
    private _lastListToolsFailure;
    /**
     * True when the last `listTools()` call took the degraded path (timeout /
     * transport error) and returned a fallback (cached or empty) instead of a
     * fresh authoritative list. Read by the defer-index path to distinguish
     * "server truly has 0 tools" from "we failed to fetch and made something up".
     * See issue #106255.
     */
    private _listToolsDegraded;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    listTools(): ReturnType<MCPServer['listTools']>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listPrompts(): Promise<McpPrompt[]>;
    /**
     * Capability declared at `initialize` and cached by the MCP client, so this
     * is a memory read that cannot time out — see MCPServer.supportsResources.
     */
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export declare class OverriddenMCPServerSSE extends MCPServerSSE implements MCPServer {
    protected underlying: OverriddenUnderlyingMCPServerSSE;
    constructor(params: ConstructorParameters<typeof MCPServerSSE>[0]);
    get onToolsListChanged(): (() => void) | undefined;
    set onToolsListChanged(callback: (() => void) | undefined);
    connect(): Promise<void>;
    listTools(): ReturnType<MCPServer['listTools']>;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    listPrompts(): Promise<McpPrompt[]>;
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export declare class OverriddenUnderlyingMCPServerStreamableHttp extends UnderlyingMCPServerStreamableHttp implements MCPServer {
    private _name;
    private transport;
    private unregisterExitTerminator?;
    onToolsListChanged?: () => void;
    connect(): Promise<void>;
    close(): Promise<void>;
    /** Timestamp of the last listTools failure. Used to skip retries for a cooldown period. */
    private _lastListToolsFailure;
    /**
     * True when the last `listTools()` call took the degraded path (timeout /
     * transport error) and returned a fallback (cached or empty) instead of a
     * fresh authoritative list. Read by the defer-index path to distinguish
     * "server truly has 0 tools" from "we failed to fetch and made something up".
     * See issue #106255.
     */
    private _listToolsDegraded;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    /**
     * Single-flight guard：并发请求同时因会话失效失败时，共享同一次重连，
     * 避免重复握手下新会话互相覆盖。
     */
    private _sessionReconnectPromise;
    /**
     * 重建会话：关闭死会话 → 清 transport 缓存 → 重新 connect() 握手，
     * 拿到全新的 Mcp-Session-Id。
     */
    private reconnectAfterSessionLoss;
    /**
     * 会话失效（HTTP 404）时重建会话并重试一次；仍失败则原样抛出，
     * 不无限重连。
     */
    private withSessionReconnect;
    listTools(): ReturnType<MCPServer['listTools']>;
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): Promise<CallToolResultContent>;
    listPrompts(): Promise<McpPrompt[]>;
    /**
     * Capability declared at `initialize` and cached by the MCP client, so this
     * is a memory read that cannot time out — see MCPServer.supportsResources.
     */
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export declare class OverriddenMCPServerStreamableHttp extends MCPServerStreamableHttp implements MCPServer {
    protected underlying: OverriddenUnderlyingMCPServerStreamableHttp;
    constructor(params: ConstructorParameters<typeof MCPServerStreamableHttp>[0]);
    get onToolsListChanged(): (() => void) | undefined;
    set onToolsListChanged(callback: (() => void) | undefined);
    connect(): Promise<void>;
    listTools(): ReturnType<MCPServer['listTools']>;
    wasListToolsDegraded(): boolean;
    resetListToolsCooldown(): void;
    listPrompts(): Promise<McpPrompt[]>;
    supportsResources(): boolean;
    listResources(): Promise<McpResource[]>;
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
