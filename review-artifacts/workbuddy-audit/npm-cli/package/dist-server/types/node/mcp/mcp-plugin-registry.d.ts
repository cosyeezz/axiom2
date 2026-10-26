/**
 * MCP server → plugin 映射的只读信息。
 */
export interface McpServerPluginInfo {
    pluginName: string;
    marketplaceName: string;
}
/**
 * MCP server → plugin 运行时映射。
 *
 * 用于在执行 MCP 工具时追溯其来源插件，主要服务于 `plugin_capability_call` 埋点。
 * 仅记录由插件注册的 MCP server，用户手动配置/项目级配置的 server 不会被登记。
 *
 * 数据只在 `PluginManager` 发布 active snapshot 时整体替换；普通插件管理
 * 操作不会提前改变当前 session 的运行时归属。
 */
export declare const MCP_PLUGIN_REGISTRY: unique symbol;
export declare class McpPluginRegistry {
    private serverToPlugin;
    /** Replace all runtime mappings when a new active plugin snapshot is published. */
    replace(entries: Iterable<readonly [string, McpServerPluginInfo]>): void;
    /**
     * 登记一个 MCP server 属于某插件。
     * 重复调用会覆盖已有映射（通常发生在插件热重载场景）。
     */
    register(serverName: string, info: McpServerPluginInfo): void;
    /**
     * 批量登记。
     */
    registerMany(serverNames: Iterable<string>, info: McpServerPluginInfo): void;
    /**
     * 查询 MCP server 对应的插件信息，未登记返回 undefined。
     */
    get(serverName: string): McpServerPluginInfo | undefined;
    /**
     * 清除某个插件下所有 MCP server 登记。
     */
    unregisterPlugin(pluginName: string, marketplaceName: string): void;
}
