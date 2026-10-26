import { ContainerUtil, Event, Logger } from '@celljs/core';
import { BuiltInMarketPluginMerge } from '@genie/product';
/**
 * 插件策略服务
 * 通过 builtInMarketPluginsMerge（由 Unleash 远程下发）控制插件的权限
 *
 * 职责：纯策略查询服务，不执行安装/卸载操作
 * 策略执行由 PluginManager 负责
 */
export declare const PluginPolicyServiceSymbol: unique symbol;
export interface PluginPolicyService {
    /** 策略变更事件 */
    readonly onDidChange: Event<void>;
    /** 获取所有合并插件策略 */
    getMergedPlugins(): BuiltInMarketPluginMerge[];
    /** 获取指定插件的合并策略 */
    getMergedPlugin(pluginId: string): BuiltInMarketPluginMerge | undefined;
    /** 插件是否不可删除 */
    isPluginCannotRemove(pluginId: string): boolean;
    /** 插件是否不可禁用 */
    isPluginCannotSwitchoff(pluginId: string): boolean;
    /** 插件是否不可编辑 */
    isPluginCannotEdit(pluginId: string): boolean;
    /** 插件是否需要自动安装（存在于 merge 列表中） */
    isPluginAutoInstall(pluginId: string): boolean;
    /** 市场是否被策略阻止（预留扩展） */
    isMarketplaceBlockedByPolicy(marketplaceName: string): boolean;
}
export declare class PluginPolicyServiceImpl implements PluginPolicyService {
    protected componentServices?: typeof ContainerUtil;
    protected get services(): typeof ContainerUtil;
    protected readonly logger: Logger;
    /** 当前生效的合并插件策略 */
    private mergedPlugins;
    /** 策略变更事件发射器 */
    private readonly onDidChangeEmitter;
    readonly onDidChange: Event<void>;
    protected init(): void;
    /**
     * 从产品配置加载合并插件策略
     * 包含格式校验 + 深比较变更检测
     */
    private loadPolicies;
    /**
     * 深比较两个策略 Map 是否有差异
     */
    private hasPluginsChanged;
    getMergedPlugins(): BuiltInMarketPluginMerge[];
    getMergedPlugin(pluginId: string): BuiltInMarketPluginMerge | undefined;
    isPluginCannotRemove(pluginId: string): boolean;
    isPluginCannotSwitchoff(pluginId: string): boolean;
    isPluginCannotEdit(pluginId: string): boolean;
    isPluginAutoInstall(pluginId: string): boolean;
    isMarketplaceBlockedByPolicy(_marketplaceName: string): boolean;
}
//# sourceMappingURL=plugin-policy-service.d.ts.map