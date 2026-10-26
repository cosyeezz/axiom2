/**
 * 只在历史输入边界把旧 mcpMeta 外壳转换为标准 ToolResult。
 * structuredContent 与 _meta 内的提供方字段保持原样，不在 Host 中解释。
 */
export declare function extractPersistedMcpUi(toolResult: unknown): Record<string, unknown> | undefined;
