import type { SdkMcpToolDefinition } from './tool-definition';
/**
 * 工具预设（QueryOptions.tools 的 preset 形，SDK `{ type: 'preset', preset }`
 * 同形）。'default' 沿用内核默认工具集合，由 Product、平台和启用规则筛选；
 * 'workbuddy' 为 cloud workbuddy 的策展工具集。
 *
 * append 追加宿主定义，保留预设的内置工具选择；数组仍表示显式选择。
 */
/**
 * cloud workbuddy 形态工具集（单一集合，2026-08-20 用户裁决定形）：以
 * workbuddy-server `mode-tools-config.ts` craft 白名单为基（desktop 实际下发
 * 的 --tools，Defer 包装保留），扣除两类：
 * - agent-cli 没有的名字：connector-proxy 裸名 widget_guidelines（旧名 read_me）/ show_widget /
 *   present_files / automation_update / Defer(conversation_search) /
 *   Defer(workbuddy_sites_deploy)——宿主侧 MCP 产品工具，其注入车道打通后
 *   归 MCP 面另议；MultiEdit——本仓 product.json default agent 工具池不含，
 *   白名单惰性项；
 * - 裁决排除：Glob / Grep / PowerShell（WebFetch 已收编：平台 API 形态+本地降级缺省关）。
 *
 * craft 基线外加项三批：StructuredOutput——server 面 jsonSchema 特性依赖它，
 * isEnabled 按 jsonSchema 门控，未用时不可见零成本。AskUserQuestion 在 server
 * 面按 canUseTool 门控（宿主无回调即不可见，不会挂死 turn）。出站 A2A 四件套
 * （2026-09-04 增补，晚于 craft 基线落地）——双层 gate 自守（a2a-gate.ts：
 * CODEBUDDY_REMOTE_AGENTS_URL × 特性开关，均 live 读），未配置时 isEnabled
 * 隐藏、入名单零成本；配置走既有进程面车道（pod env / start({env}) /
 * settings.env），无须 QueryOptions 新口。REPL（2026-10-13 增补，server 形态
 * 要支持 Code Mode）——自带总闸 isReplEnabled（CODEBUDDY_REPL_ENABLED 显式值
 * 优先，否则主 Agent 为 PTC / Minimal 时才开），未开启时 isEnabled 隐藏；入名单
 * 同时让 tools/repl/ 随 server 产物发布（构建期兜底白名单不再整目录置空）。
 */
export declare const WORKBUDDY_TOOLS: readonly string[];
export interface ToolsPreset {
    type: 'preset';
    preset: 'default' | 'workbuddy';
    append?: readonly SdkMcpToolDefinition[];
}
export type ToolsOption = string[] | ToolsPreset;
/**
 * 解析 tools 选项为内核 `--tools` 白名单串；undefined 原样透传（不写
 * merged.tools，即内核默认全集）。`[]` 拼成空串——内核可用性门
 * （agent-manager isEnabled 白名单层）对"已定义但为空"走显式全禁分支，
 * 即 SDK `[]` = 禁用全部内置工具的同语义。
 */
export declare function resolveToolsOption(tools: ToolsOption | undefined): string | undefined;
