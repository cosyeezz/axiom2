/**
 * 插件系统
 *
 * 提供完整的插件管理功能,包括:
 * 1. 市场管理: 支持本地/Git/HTTP多种市场源
 * 2. 插件管理: 安装/卸载/启用/禁用插件
 * 3. 扩展加载: 自动加载agents/commands/skills/mcps等扩展
 *
 * @example
 * // 添加市场
 * const marketplace = await marketplaceManager.add('./local-marketplace', 'my-marketplace');
 *
 * // 安装插件
 * await pluginManager.install('my-plugin', 'my-marketplace', { autoEnable: true });
 *
 * // 列出已安装插件
 * const plugins = await pluginManager.getInstalled();
 */
export * from './plugin-protocol';
export * from './concurrency';
export * from './marketplace-name-validator';
export * from './marketplace-path-safety';
export * from './dependency-resolver';
export * from './plugin-environment';
export * from './plugin-policy-service';
export * from './plugin-runtime-refresh-service';
export * from './plugin-options-storage';
export * from './plugin-validator';
export * from './mcpb-handler';
export * from './zip-utils';
export * from './marketplaces';
export * from './plugin-manager';
export * from './loaders';
export * from './plugin-controller';
export * from './installers';
export * from './plugin-error-collector';
export * from './plugin-install-stats-service';
export * from './guards';
export * from './directory-plugin-cache-projection';
export * from './plugin-mcp-snapshot';
export * from './session-plugin-snapshot';
export * from './plugin-read-summary';
export * from './plugin-operation';
//# sourceMappingURL=index.d.ts.map