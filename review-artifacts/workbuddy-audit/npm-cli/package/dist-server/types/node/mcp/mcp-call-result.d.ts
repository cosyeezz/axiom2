/**
 * 官方 mods `McpToolResult`（`$.mcp.call` 的返回）：MCP tools/call 结果的纯数据形态。
 *
 * 对齐 claude-code.d.ts：`{ content: McpContentBlock[]; isError: boolean; structuredContent?: unknown }`。
 * `_meta` 不在官方形态里，不透出。
 */
export interface McpToolCallResult {
    content: unknown[];
    isError: boolean;
    structuredContent?: unknown;
}
/** server 回的 CallToolResult（经 `__resultMetaSink` 旁路捞回）。 */
export type RawCallToolResult = Record<string, unknown> & {
    content?: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
};
export declare function rememberMcpCallResult(toolResult: object, raw: RawCallToolResult): void;
export declare function recallMcpCallResult(toolResult: unknown): RawCallToolResult | undefined;
/**
 * 原始 CallToolResult → 官方 McpToolResult。
 *
 * 拿不到原始结果说明调用没有真正到达 server（未连接 / 出站审查拒绝 / 宿主拦截），
 * 按失败返回，正文用宿主给出的说明文字，不能伪装成成功。
 */
export declare function toMcpToolCallResult(raw: RawCallToolResult | undefined, fallbackText: string): McpToolCallResult;
