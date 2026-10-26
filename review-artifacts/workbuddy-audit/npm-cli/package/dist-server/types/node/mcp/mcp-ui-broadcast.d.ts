/**
 * MCP Apps（io.modelcontextprotocol/ui）广播辅助。
 *
 * 直连路径（defer_loading:false → FunctionTool → callTool）的 ACP callId
 * 由 agent_tool_start 写入 McpToolCallContext（按 callId 并发登记），callTool
 * 出口读取后广播；DeferExecuteTool 仍用自身 execute(details) 的 callId。
 * 本模块是两者共用的唯一广播实现（#80575）。
 *
 * 同时写入 McpUiPendingResults，供主连接 function_call_result 挂 mcpUi。
 */
import type { Logger } from '@genie/telemetry';
import { type McpUiBroadcastPayload } from '../acp/acp-protocol';
import type { MCPServer, McpToolResultContent } from './mcp-protocol';
/** 对齐 acp-protocol：超阈值省略 html，由 Web UI / Host 经 resources/read 回拉。 */
export declare const MCP_UI_HTML_MAX_BYTES: number;
export type McpCallToolResultMeta = Record<string, unknown> & {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    isError?: boolean;
};
/**
 * 从 resources/read 结果挑出 ui:// HTML；超阈值返回 undefined。
 */
export declare function pickPrefetchedMcpUiHtml(contents: Array<{
    mimeType?: string;
    text?: string;
    blob?: string;
}>, maxBytes?: number): {
    html: string;
    mimeType?: string;
} | undefined;
/**
 * 从 `resources/read` 结果挑出资源级 `_meta.ui`。
 *
 * 规范把 `_meta.ui` 分两层：tool 定义上只有 `resourceUri` / `visibility`，而
 * `csp` / `permissions` / `domain` / `prefersBorder` 只在资源侧。抽取口径与
 * workbuddy-server `resolver.ts` 一致。
 */
export declare function pickResourceUiMetadata(contents: Array<{
    _meta?: Record<string, unknown>;
}>): Record<string, unknown> | undefined;
/**
 * 从工具结果 / 工具定义 `_meta` 中解析 MCP Apps UI 资源 URI。
 * 规范：`_meta.ui.resourceUri`；兼容废弃的扁平写法 `_meta["ui/resourceUri"]`。
 */
export declare function extractUiResourceUri(meta: Record<string, unknown> | undefined): string | undefined;
/**
 * 从 tool definition（listTools）查 `_meta.ui.resourceUri`。
 *
 * 官方 `@modelcontextprotocol/ext-apps` 系列示例只在工具定义声明 ui，
 * callTool 返回值不重复携带——必须 fallback 到这里。
 */
export declare function lookupUiFromToolDefinition(server: MCPServer, fullToolName: string, logger?: Pick<Logger, 'debug' | 'info' | 'warn'>): Promise<{
    resourceUri: string;
    uiMeta?: Record<string, unknown>;
} | undefined>;
export interface BroadcastMcpUiParams {
    server: MCPServer;
    /** 对外工具全名，如 mcp__ardot__create_design */
    fullToolName: string;
    params: Record<string, unknown>;
    resultContent: McpToolResultContent;
    resultMeta?: McpCallToolResultMeta;
    /** 结果侧已解析出的 uiResourceUri（可选，缺省时再查 tool definition） */
    uiResourceUri?: string;
    sessionId: string;
    toolCallId: string;
    logger?: Pick<Logger, 'debug' | 'info' | 'warn'>;
}
/**
 * 若工具声明了 UI 资源，经 ACP 透传 URI 与完整 CallToolResult。
 * 全程不抛错，不阻断工具主流程。
 *
 * 成功时同时写入 McpUiPendingResults，保证主连接（非广播收件人）也能从
 * function_call_result 拿到 mcpUi。
 *
 * @returns mcpUi 载荷；旧 CLI 广播是可选旁路，Server 由结果投影和历史承载。
 */
export declare function broadcastMcpUiForToolCall(params: BroadcastMcpUiParams): Promise<McpUiBroadcastPayload | undefined>;
