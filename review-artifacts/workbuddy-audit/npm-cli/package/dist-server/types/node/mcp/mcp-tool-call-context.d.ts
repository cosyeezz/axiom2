/**
 * 当前进行中的 ACP toolCall 上下文（#80575）。
 *
 * 直连 MCP（agents-core mcpToFunctionTool）默认丢弃 invoke 第三参 details，
 * 拿不到 callId。SDK 在 invoke 之前会同步 emit agent_tool_start（含
 * toolCall.callId），此处按 callId 登记 toolName，供 createServerProxy.callTool
 * 出口广播 mcpUi。
 *
 * 必须支持并发：同一 turn 内多个 tool 并行时，不能用单槽 ALS + 全局 clear，
 * 否则先结束的 builtin（如 Read）会冲掉仍在执行的 create_design 的 callId，
 * 导致 mcpUi 无法广播、MCP Apps 断渲染。
 *
 * 防双发：DeferExecuteTool 外层 start 写入的 toolName 是 DeferExecuteTool，
 * 内层 callTool 的 originalToolName 是 mcp__*，二者不一致则不在 callTool
 * 出口广播（仍由 DeferExecuteTool.maybeBroadcastMcpUi 负责）。
 */
export interface McpToolCallStore {
    callId: string;
    toolName: string;
    sessionId?: string;
}
export declare const McpToolCallContext: {
    enter(callId: string, toolName: string, sessionId?: string): void;
    /** 按 callId 移除；并行场景下绝不能清空整表 */
    leave(callId: string): void;
    /** 测试用：清空全部活跃登记 */
    clear(): void;
    /**
     * 仅当活跃登记中的 toolName 与正在执行的 MCP 工具名一致时返回 callId。
     * 调用方提供 sessionId 时优先命中同一会话，避免多 ACP 连接并行调用同名
     * MCP 工具时串用另一个连接的 callId。
     * 用于区分「直连 FunctionTool」与「DeferExecuteTool 内层 callTool」。
     *
     * 登记侧没记下 sessionId 时默认退回按工具名匹配：`enter` 的 sessionId 取自
     * `agent_tool_start` 的 `ctx.context`，而查询侧 `mcp-server-manager` 的
     * session 来自 `toolMetaResolver`，后者在 `ctx.runContext.context` 为空时
     * 会兜底成 `options.session`。两边就此错开的话严格比对会一律落空，直连
     * MCP 静默丢掉 ACP callId —— widget 广播失效等于 MCP Apps 断渲染，比不做
     * 会话隔离更糟。两边都记到了 sessionId 时隔离照常严格生效。
     *
     * `strictSession` 给容不下这层宽松的调用方用：sessionless 登记可能属于另一条
     * ACP 连接，拿错 callId 的后果若比拿不到更严重，就应该要求严格同会话，落空时
     * 由调用方自行 fail-open。循环闸门就是这种情况——见 mcp-server-manager 的
     * `loopGuardCallId`。
     */
    getCallIdForTool(toolName: string, sessionId?: string, options?: {
        strictSession?: boolean;
    }): string | undefined;
    /** 活跃登记数；供「广播被跳过」的诊断区分「未登记」与「工具名不匹配」。 */
    activeCount(): number;
    /** 测试用：无活跃调用返回 undefined；否则返回其中一个 */
    getStore(): McpToolCallStore | undefined;
};
