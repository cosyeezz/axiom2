/**
 * 直连 FunctionTool 路径的 mcpUi 旁路缓存（#80575）。
 *
 * WorkBuddy Desktop 启用 session-payload 身份后，`AcpBroadcastService.recipients(sessionId)`
 * 在无 runtimeHandle 时返回空集——`broadcastMcpUi` 发不出去。DeferExecuteTool 靠把
 * `mcpUi` 挂到 `ToolResult` 再经主连接 `function_call_result` 透传；直连路径只返回
 * content 数组，必须在 callTool 出口把载荷按 toolCallId 暂存，供
 * FunctionCallResultAgentInputItemProcessor / acp-utils 挂到
 * `providerData.toolResult.mcpUi`。
 */
import type { McpUiBroadcastPayload } from '../acp/acp-protocol';
export declare const McpUiPendingResults: {
    set(toolCallId: string, mcpUi: McpUiBroadcastPayload): void;
    /** 取出并删除；无则 undefined */
    take(toolCallId: string | undefined): McpUiBroadcastPayload | undefined;
    /** 测试用 */
    clear(): void;
    /** 测试用 */
    size(): number;
};
