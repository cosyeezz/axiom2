/**
 * SDK MCP Server
 *
 * SDK MCP Server 是一种特殊类型的 MCP 服务器，它不通过标准的 stdio 或 HTTP 传输层通信，
 * 而是通过 CLI 程序内部的 control_request/control_response 消息机制进行通信。
 *
 * 使用场景：IDE/SDK 集成时，由外部 SDK（如 VS Code 扩展）注册和管理的 MCP 服务器。
 */
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { GetPromptResult, McpPrompt, McpResource, McpResourceTemplate, MCPServer, ReadResourceResult } from './mcp-protocol';
/**
 * Logger 接口（简化版本，与 @openai/agents-core 的 Logger 兼容）
 */
interface SimpleLogger {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
}
interface SdkMcpServerBaseParams {
    /**
     * 服务器名称
     */
    name: string;
    /**
     * 日志记录器
     */
    logger?: SimpleLogger;
    /**
     * 连接超时时间（毫秒）
     */
    timeout?: number;
    /**
     * 工具过滤器（权限/deny 过滤）
     * 由 OpenAI agents SDK 在每次构建工具列表时调用
     */
    toolFilter?: (...args: any[]) => Promise<boolean>;
}
/**
 * SDK MCP Server 配置参数。
 *
 * Historical SDK/control-message callers provide `sendMcpMessage`. Standard
 * transports such as MCP-over-ACP provide an exact transport factory instead,
 * while reusing the same MCP Client and feature surface.
 */
export type SdkMcpServerParams = SdkMcpServerBaseParams & ({
    sendMcpMessage: (serverName: string, message: JSONRPCMessage, signal?: AbortSignal) => Promise<JSONRPCMessage>;
    sdkInstance?: never;
    transportFactory?: never;
} | {
    sendMcpMessage?: never;
    sdkInstance: unknown;
    transportFactory?: never;
} | {
    sendMcpMessage?: never;
    sdkInstance?: never;
    transportFactory: () => Transport | Promise<Transport>;
});
/**
 * SDK MCP Server 实现
 *
 * 实现了 MCPServer 接口，使用 SdkMcpTransport 作为传输层，
 * 通过 control_request/control_response 机制与 SDK 端的 MCP 服务器通信。
 */
export declare class SdkMcpServer implements MCPServer {
    readonly name: string;
    private readonly params;
    private readonly logger;
    /**
     * Tool filter exposed for the OpenAI agents SDK.
     * The SDK reads `server.toolFilter` during `getFunctionToolsFromServer`
     * to decide which tools to include in the LLM tool list.
     */
    toolFilter?: (...args: any[]) => Promise<boolean>;
    private transport;
    private session;
    private _toolsList;
    private _cacheDirty;
    cacheToolsList: boolean;
    private _lastListToolsFailure;
    onToolsListChanged?: () => void;
    /**
     * Short timeout (ms) for resources/list and resources/templates/list. These
     * sit on the per-turn reply critical path, so a stalled server must degrade
     * fast rather than wait out the default 60s request timeout.
     */
    private static readonly RESOURCE_LIST_TIMEOUT_MS;
    private static readonly mockLogger;
    constructor(params: SdkMcpServerParams);
    /**
     * 连接到 SDK MCP Server
     *
     * 创建 SdkMcpTransport 并通过它连接到 SDK 端的 MCP 服务器。
     */
    connect(): Promise<void>;
    private createTransport;
    /**
     * 关闭 SDK MCP Server 连接
     */
    close(): Promise<void>;
    /**
     * Register channel notification handlers on MCP Client session.
     * Wake-up pattern mirrors startTeamLeadInboxPolling() in team-create-tool.ts.
     */
    private registerChannelNotificationHandlers;
    /**
     * 使工具缓存失效
     */
    invalidateToolsCache(): Promise<void>;
    /** Cooldown period (ms) after a listTools failure before retrying. */
    private static readonly LIST_TOOLS_RETRY_COOLDOWN;
    /**
     * 列出可用工具
     */
    listTools(): ReturnType<MCPServer['listTools']>;
    /**
     * 调用工具
     */
    callTool(toolName: string, args: Record<string, unknown> | null, meta?: Record<string, unknown> | null): ReturnType<MCPServer['callTool']>;
    /**
     * 列出可用 prompts
     */
    listPrompts(): Promise<McpPrompt[]>;
    /**
     * Capability declared at `initialize` and cached by the MCP client, so this
     * is a memory read that cannot time out — see MCPServer.supportsResources.
     */
    supportsResources(): boolean;
    /**
     * 列出可用 resources
     */
    listResources(): Promise<McpResource[]>;
    /**
     * 列出 resource templates
     */
    listResourceTemplates(): Promise<McpResourceTemplate[]>;
    /**
     * 获取 prompt
     */
    getPrompt(promptName: string, args?: Record<string, string>): Promise<GetPromptResult['messages']>;
    /**
     * 读取 resource
     */
    readResource(request: {
        uri: string;
    }): Promise<ReadResourceResult['contents']>;
}
export {};
