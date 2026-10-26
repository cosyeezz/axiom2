import { Marketplace, MarketplaceType, PluginInfo, PluginInstallScope } from '../../vendor/cbc-plugins/node/index.js';
/**
 * 插件市场埋点服务
 * 负责上报插件市场相关的埋点事件
 */
export declare const PluginTelemetryService: unique symbol;
export interface PluginTelemetryService {
    /**
     * 上报市场操作事件 (plugin_marketplace_action)
     * 用户添加/删除/刷新市场时调用
     */
    reportMarketplaceAction(data: MarketplaceActionData): void;
    /**
     * 上报市场页面曝光事件 (plugin_marketplace_page_show)
     * 用户进入插件市场页面时调用
     */
    reportMarketplacePageShow(data: MarketplacePageShowData): void;
    /**
     * 上报插件操作事件 (plugin_action)
     * 用户安装/卸载/启用/禁用插件时调用
     */
    reportPluginAction(data: PluginActionData): void;
}
/**
 * 市场操作埋点数据
 */
export interface MarketplaceActionData {
    /** 市场信息（操作失败时可能为 undefined） */
    marketplace?: Marketplace;
    /** 市场名称（操作失败时如果没有 marketplace 则使用此字段） */
    marketplaceName?: string;
    /** 市场来源（操作失败时如果没有 marketplace 则使用此字段） */
    marketplaceSource?: string;
    /** 市场类型（操作失败时如果没有 marketplace 则使用此字段） */
    marketplaceType?: MarketplaceType;
    /** 用户操作 */
    action: 'add' | 'remove' | 'refresh';
    /** 操作是否成功 */
    actionSuccessful: boolean;
    /** 错误代码（操作失败时） */
    errorCode?: string;
    /** 错误信息（操作失败时） */
    errorMessage?: string;
}
/**
 * 市场页面曝光埋点数据
 */
export interface MarketplacePageShowData {
    /** 当前选中的市场名称 */
    marketplaceName?: string;
    /** 可用市场总数 */
    marketplaceCount: number;
    /** 已安装插件总数 */
    installedPluginCount: number;
}
/**
 * 插件操作埋点数据
 */
export interface PluginActionData {
    /** 插件信息 */
    plugin: PluginInfo;
    /** 所属市场 */
    marketplace: Marketplace;
    /** 用户操作 */
    action: 'install' | 'uninstall' | 'enable' | 'disable' | 'update';
    /** 安装作用域 */
    scope: PluginInstallScope;
}
