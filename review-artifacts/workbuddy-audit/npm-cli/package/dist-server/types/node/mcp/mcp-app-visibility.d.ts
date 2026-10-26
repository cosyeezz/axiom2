/**
 * MCP Apps 工具可见性：`_meta.ui.visibility` 中 `model` = Agent 可见可调用，`app` = 仅该
 * server 的 App 可调用，缺省 `["model","app"]`。app-only 工具必须移出 Agent 工具面 —— 它的
 * 唯一调用方是 App 自己，那条链路走 daemon 代理，不经 Agent CLI。
 *
 * 未依赖 ext-apps，函数体逐行对齐 `@modelcontextprotocol/ext-apps@1.7.4`（`app-bridge`）的
 * `isToolVisibilityAppOnly`：为一条判定引入整套 App 运行时（zod / AppBridge）不划算。
 * 升级 ext-apps 时需对照官方实现同步。
 */
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
/** 工具是否只对 App 可见（模型侧必须隐藏）。对应官方 `isToolVisibilityAppOnly`。 */
export declare function isMcpAppOnlyTool(tool: Partial<Tool>): boolean;
/** 从 Agent 工具面剔除 app-only 工具。 */
export declare function filterModelHiddenMcpTools<T extends Partial<Tool>>(tools: readonly T[]): T[];
