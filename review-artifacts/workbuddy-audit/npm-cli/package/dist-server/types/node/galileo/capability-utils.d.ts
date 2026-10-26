/**
 * 工具调用 → 能力类型/实例 归一推导（会话级能力归因）。
 *
 * 给 agent.tool.*_detail 提供 capability_type + capability_id 两个维度，使后台可按
 * 「mcp / plugin / connector / skill / builtin」聚合一次会话用了哪些能力。
 *
 * 推导顺序固定为 skill → connector → plugin → mcp → builtin（见各分支注释），
 * 确保 plugin / connector 提供的 MCP 工具不被误判为裸 mcp。
 *
 * 设计为纯函数 + 回调注入（pluginNameResolver），避免直接依赖 DI 的 McpPluginRegistry，
 * 便于单测；调用方（GalileoSessionBridge）注入 registry 查询能力。
 */
/** 能力类型枚举（与 spec 对齐）。 */
export type CapabilityType = 'builtin' | 'mcp' | 'plugin' | 'connector' | 'skill';
/**
 * connector 透明代理的固定 MCP server 名。
 *
 * connector 工具不走 mcp__{connectorServer}__ 形态，而是统一挂在 connector-proxy 这个
 * MCP server 下（见 workbuddy-server/src/connector/mcp-config.ts 的 CONNECTOR_PROXY_MCP_NAME）。
 * 因此 CLI 侧用 `mcp__connector-proxy__` 前缀即可判定 capability_type=connector。
 *
 * 这里硬编码常量值（不 import workbuddy-server，避免 agent-cli 反向依赖宿主包）；
 * 若 workbuddy-server 改名需同步本常量。
 */
export declare const CONNECTOR_PROXY_SERVER_NAME = "connector-proxy";
export interface CapabilityAttribution {
    capabilityType: CapabilityType;
    capabilityId: string;
}
/**
 * 推导工具的能力归属。
 *
 * @param toolName 原始工具名（mcp__server__tool / Skill / Read 等）
 * @param opts.skillId Skill 工具的具体 skill 名（仅 toolName === 'Skill' 时有意义）
 * @param opts.pluginNameResolver 给定 serverName 返回 pluginName（来自 McpPluginRegistry），未登记返回 undefined
 */
export declare function resolveCapabilityAttribution(toolName: string | undefined, opts?: {
    skillId?: string;
    pluginNameResolver?: (serverName: string) => string | undefined;
    /**
     * connector 真实 serverShortName，来自 PostToolUse 时 tool_response._meta['workbuddy.ai/connectorServer']
     * （connector-proxy 回传）。提供时把 connector 的 capability_id 从占位 connector-proxy 升级为真实 id。
     */
    connectorServerOverride?: string;
}): CapabilityAttribution;
