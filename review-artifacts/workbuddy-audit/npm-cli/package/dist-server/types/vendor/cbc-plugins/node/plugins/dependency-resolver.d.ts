/**
 * 插件依赖解析器
 * DFS 闭包算法，支持循环检测、跨市场限制、自动降级
 *
 * 参考: Claude Code dependencyResolver.ts (305行)
 */
export interface PluginDependencyNode {
    /** 插件 ID (name@marketplace) */
    id: string;
    /** 插件名称 */
    name: string;
    /** 市场名称 */
    marketplace: string;
    /** 依赖列表（插件 ID 格式） */
    dependencies: string[];
}
export interface DependencyResolutionResult {
    /** 解析成功的依赖闭包（按拓扑排序） */
    resolved: string[];
    /** 缺失的依赖 */
    missing: string[];
    /** 循环依赖链 */
    cycles: string[][];
    /** 被降级（自动禁用）的插件 */
    demoted: string[];
}
/**
 * 使用 DFS 解析插件的传递依赖闭包
 *
 * @param rootId 根插件 ID
 * @param lookup 所有可用插件的映射
 * @returns 传递依赖的 ID 集合（不包含 rootId 本身）
 */
export declare function resolveDependencyClosure(rootId: string, lookup: Map<string, PluginDependencyNode>): DependencyResolutionResult;
/**
 * 验证并降级：检查所有插件的依赖是否满足
 * 如果某个插件的依赖缺失或有循环，自动将其标记为降级（禁用）
 *
 * @param plugins 所有启用的插件列表
 * @param allowCrossMarketplaceDeps 是否允许跨市场依赖（默认 false）
 * @returns 降级结果
 */
export declare function verifyAndDemote(plugins: PluginDependencyNode[], allowCrossMarketplaceDeps?: boolean): DependencyResolutionResult;
//# sourceMappingURL=dependency-resolver.d.ts.map