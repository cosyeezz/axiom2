import type { AgentSideConnection, ClientCapabilities } from '@agentclientprotocol/sdk';
import type { FunctionCallItem, RunContext } from '../../vendor/cbc-shared/node/index.js';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { ToolResult } from '../tools/tool-protocol';
export type { AgentSideConnection, ClientCapabilities, ReadTextFileRequest, ReadTextFileResponse, TerminalHandle, TerminalOutputResponse, WriteTextFileRequest, WriteTextFileResponse, } from '@agentclientprotocol/sdk';
export declare const AcpContext: unique symbol;
export declare const AcpToolInterceptor: unique symbol;
export declare const DelegateToolManager: unique symbol;
export interface AcpContext {
    isAcpMode(): boolean;
    setAcpMode(enabled: boolean): void;
}
/**
 * 工具拦截器接口
 *
 * 为需要代理的工具提供拦截能力。
 * 每个工具方法提供 isSupport 判断是否支持代理，以及 call 方法执行代理逻辑。
 *
 * 参考 claude-code-acp/src/acp-agent.ts newSession 中的代理逻辑：
 * - Read: 基于 clientCapabilities.fs.readTextFile
 * - Write/Edit/MultiEdit: 基于 clientCapabilities.fs.writeTextFile
 * - Bash/BashOutput/KillShell: 基于 clientCapabilities.terminal
 */
export interface AcpToolInterceptor {
    /**
     * 设置 ACP 连接
     * 需要在 AcpAgent 初始化时调用
     */
    setConnection(connection: AgentSideConnection): void;
    /**
     * 设置客户端能力
     * 直接使用 ACP 的 ClientCapabilities 类型
     */
    setCapabilities(capabilities: ClientCapabilities | undefined): void;
    /**
     * 获取当前能力配置
     */
    getCapabilities(): ClientCapabilities | undefined;
    /**
     * 获取文件内容缓存
     * 用于计算编辑操作中受影响的行号
     */
    getFileContentCache(): Record<string, string>;
    /**
     * 判断是否支持 Read 工具代理
     */
    isSupportRead(): boolean;
    /**
     * 执行 Read 工具代理
     */
    callRead(input: {
        file_path: string;
        offset?: number;
        limit?: number;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 Write 工具代理
     */
    isSupportWrite(): boolean;
    /**
     * 执行 Write 工具代理
     */
    callWrite(input: {
        file_path: string;
        content: string;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 Edit 工具代理
     */
    isSupportEdit(): boolean;
    /**
     * 执行 Edit 工具代理
     */
    callEdit(input: {
        file_path: string;
        old_string: string;
        new_string: string;
        replace_all?: boolean;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 MultiEdit 工具代理
     */
    isSupportMultiEdit(): boolean;
    /**
     * 执行 MultiEdit 工具代理
     */
    callMultiEdit(input: {
        file_path: string;
        edits: Array<{
            old_string: string;
            new_string: string;
            replace_all?: boolean;
        }>;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 Bash 工具代理
     */
    isSupportBash(): boolean;
    /**
     * 执行 Bash 工具代理
     */
    callBash(input: {
        command: string;
        timeout?: number;
        description?: string;
        run_in_background?: boolean;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 BashOutput 工具代理
     */
    isSupportBashOutput(): boolean;
    /**
     * 执行 BashOutput 工具代理
     */
    callBashOutput(input: {
        shell_id: string;
        filter?: string;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 KillShell 工具代理
     */
    isSupportKillShell(): boolean;
    /**
     * 执行 KillShell 工具代理
     */
    callKillShell(input: {
        shell_id: string;
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * 判断是否支持 AskUserQuestion 工具代理
     * 基于 clientCapabilities._meta["codebuddy.ai"].question
     */
    isSupportAskUserQuestion(): boolean;
    /**
     * 执行 AskUserQuestion 工具代理
     * 通过 extMethod '_codebuddy.ai/question' 发送到客户端
     */
    callAskUserQuestion(input: {
        questions: Array<{
            question: string;
            header: string;
            options: Array<{
                label: string;
                description: string;
            }>;
            multiSelect?: boolean;
        }>;
        metadata?: {
            source?: string;
        };
    }, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
}
/**
 * Delegate Tool Manager Interface
 *
 * Manages delegate tools provided by client-side tool providers.
 * Handles tool registration, removal, and execution via ACP extension methods.
 */
export interface DelegateToolManager {
    /**
     * Register a delegate tool from a client-side provider
     * @param toolId Tool ID
     * @param definition Tool definition (name, description, schema, etc.)
     * @param providerId Client provider identifier
     */
    registerTool(toolId: string, definition: {
        name: string;
        description: string;
        inputSchema: Record<string, unknown>;
        provider?: string;
        category?: string;
        requiresApproval?: boolean;
    }, providerId: string): Promise<void>;
    /**
     * Unregister a delegate tool
     * @param toolId Tool ID to remove
     */
    unregisterTool(toolId: string): Promise<void>;
    /**
     * Check if any delegate tools are registered
     * @returns true if any delegate tools exist
     */
    hasTools(): boolean;
    /**
     * Get all registered delegate tools
     * @returns Map of tool ID to tool definition
     */
    getTools(): Map<string, any>;
    /**
     * Execute a delegate tool on the client side
     * @param toolId Tool ID to execute
     * @param input Tool input parameters
     * @param timeout Execution timeout in milliseconds
     * @param signal Optional abort signal for cancellation
     * @returns Tool execution result
     */
    executeTool(toolId: string, input: Record<string, unknown>, timeout?: number, signal?: AbortSignal): Promise<{
        status: string;
        output?: unknown;
        error?: string;
    }>;
    /**
     * Clear all delegate tools (typically on connection close)
     * @param providerId Optional provider ID to clear only tools from that provider
     */
    clearTools(providerId?: string): Promise<void>;
    /**
     * Get available delegate tools for a session
     * @param sessionId Session ID
     * @returns List of available tool definitions
     */
    getAvailableTools(sessionId: string): any[];
    /**
     * Set the ACP connection for sending extension method requests
     * @param connection AgentSideConnection instance
     */
    setConnection(connection: AgentSideConnection): void;
    /**
     * Clear the ACP connection when disconnected
     */
    clearConnection(): void;
    /**
     * Set callback to be invoked when delegate tools are registered/unregistered
     * Used to trigger dynamic refresh of tool descriptions
     * @param callback Function to call when tools change
     */
    setOnToolsChanged(callback: () => Promise<void>): void;
}
/**
 * MCP UI 模型上下文挂载键（session 附加位）。原居 acp-agent.ts——
 * system-reminder-interceptor（agent 桶/server 图内）取这一个 Symbol 曾拖起
 * 整个 acp-agent 实现+ACP SDK 静态臂（heap 深挖第三刀）。
 */
export declare const MCP_UI_MODEL_CONTEXT: unique symbol;
