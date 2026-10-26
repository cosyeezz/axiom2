/**
 * MCP server 解析工具 —— 用于伽利略 metric 维度增强。
 *
 * CLI 内 MCP tool 命名约定：`mcp__{serverName}__{toolName}`
 * （见 packages/agent-cli/src/node/tools/tool-manager.ts:1390 的 reportMcpToolCapabilityCall）。
 *
 * serverName 不允许包含 `__`，所以用第一次出现的 `__` 切分即可。
 *
 * 注：bare MCP tool（来自 ToolSearchService.deferredTools，命名不带 `mcp__` 前缀）
 * 不在本 helper 覆盖范围内 —— 调用方需要自行根据 toolInfo.serverName 兜底。
 */
export declare function parseMcpServerFromToolName(toolName: string | undefined): string | undefined;
/**
 * 给 metric 维度填 mcp_server 字段。
 *  - mcp__xxx__yyy → 'xxx'
 *  - 内置 tool（Read/Write/Bash 等） → 'builtin'
 */
export declare function resolveMcpServerDim(toolName: string | undefined): string;
