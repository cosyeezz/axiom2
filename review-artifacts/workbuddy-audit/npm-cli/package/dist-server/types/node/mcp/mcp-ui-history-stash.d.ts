/**
 * MCP FunctionTool 路径：把 mcpUi 暂存，供 history processor
 * 写入 providerData.toolResult.mcpUi（数组返回值经 JSON 序列化会丢掉非枚举字段）。
 *
 * Legacy DeferExecuteTool 直接把 mcpUi 挂在 ToolResult 上；Harness 委托调用仍走本 stash。
 *
 * callId 约定：由 agents-core / ACP toolCall.callId 在单次 tool 调用内唯一分配；
 * 本模块按 callId 键存。CLI 为长驻进程，异常路径可能不 take，因此必须有 TTL /
 * 容量上限，避免 pending Map 无界增长与极端 callId 复用时的跨轮次串扰。
 * （不要在 McpToolCallContext.leave 时清理：leave 早于 history processor 的 take。）
 */
import type { McpUiBroadcastPayload } from '../acp/acp-protocol';
/** 视图构建成功后挂起，等待同进程 history 落盘消费。 */
export declare function stashMcpUiForHistory(toolCallId: string, mcpUi: McpUiBroadcastPayload): void;
/** 取出并删除；processor 写入 providerData 时调用。 */
export declare function takeMcpUiForHistory(toolCallId: string | undefined): McpUiBroadcastPayload | undefined;
/** 单测清理。 */
export declare function clearMcpUiHistoryStash(): void;
/** 单测观测。 */
export declare function mcpUiHistoryStashSize(): number;
