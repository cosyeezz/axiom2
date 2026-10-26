import type { Session } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { ToolResult } from '../tools/tool-protocol';
/** env 显式 0/false/no/off 时，非 MCP 工具不能声明 MCP App 视图（默认开，语义同 CBC_ENABLE_FUNCTION_HOOKS）。 */
export declare const MCP_APP_VIEWS_ENV_VAR = "CBC_MCP_APP_VIEWS";
export declare function isMcpAppViewsDisabled(env?: NodeJS.ProcessEnv): boolean;
/**
 * 工具结果声明的 MCP App 视图 → 当前工具卡。
 *
 * 任何经 ToolManager 的工具（内置工具、mod 在 `tool.call` 里改写的结果）都可以在
 * `ToolResult.mcpMeta` 里声明 `uiServer` + `ui://` 资源（`uiResourceUri` 或标准
 * `_meta.ui.resourceUri`）和要喂给视图的 `structuredContent`。宿主只做两件事：
 * 从该 server 只读 `resources/read` 预取 HTML，再复用 MCP 工具同一条
 * `toolMetaData.mcpUi` 通道挂到本次工具卡。视图里按钮的反向调用照旧走
 * `mcpUiCallTool`（带用户审批）。
 *
 * 数据由调用方自己取（如 mod 用 `$.mcp.call`，走权限 / 审批 / 出站审查），
 * 宿主不替任何人执行工具。MCP 工具自己的视图已在各自调用路径挂好（带 `mcpUi`），这里跳过。
 *
 * 全程 fail-open：任何异常只记日志，工具结果原样返回。
 *
 * @returns 是否已挂上视图
 */
export declare function attachMcpAppView(toolResult: ToolResult, toolName: string, toolInput: Record<string, unknown>, session: Session | undefined, toolCallId: string | undefined, logger?: Pick<Logger, 'info' | 'warn' | 'debug'>): Promise<boolean>;
