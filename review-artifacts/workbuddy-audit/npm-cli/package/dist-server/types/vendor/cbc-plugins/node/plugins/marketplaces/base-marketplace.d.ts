import { ContainerUtil } from '@celljs/core';
import { Marketplace, MarketplaceInfo, MarketplaceManifest, MarketplaceSource, MarketplaceType, PluginInfo, ProgressCallback } from '../plugin-protocol';
/**
 * 市场实体类
 */
export declare class BaseMarketplace implements Marketplace {
    protected componentServices?: typeof ContainerUtil;
    protected get services(): typeof ContainerUtil;
    name: string;
    storageName: string;
    manifestName?: string;
    /** 见 {@link MarketplaceInfo.declaredName}。 */
    declaredName?: string;
    type: MarketplaceType;
    source: MarketplaceSource;
    installLocation: string;
    description?: string;
    lastUpdated?: string;
    isBuiltIn?: boolean;
    autoUpdate?: boolean;
    autoUpdateSource?: 'user';
    manifest?: MarketplaceManifest;
    constructor();
    init(marketplaceInfo: MarketplaceInfo): void;
    loadManifest(): Promise<void>;
    install(onProgress?: ProgressCallback): Promise<void>;
    update(onProgress?: ProgressCallback): Promise<boolean>;
    /**
     * 列出市场中的所有插件
     * 仅返回marketplace.json中定义的插件元数据,不执行安装
     * 实际安装由PluginManager通过PluginInstaller完成
     */
    listPlugins(): Promise<PluginInfo[]>;
    /**
     * 获取指定插件信息
     * @param pluginName 插件名称
     * @returns 插件信息，如果不存在则抛出异常
     */
    getPlugin(pluginName: string): Promise<PluginInfo | undefined>;
    /**
     * 转换为JSON对象
     *
     * 注意：必须包含 `storageName`，否则 marketplace 信息一旦经过 toJSON()
     *（例如对外 API 响应、跨进程消息、缓存持久化）就会丢失稳定 ID。
     * `name` 在 loadManifest() 后会被 manifest.name 覆盖，是不稳定字段，
     * 不能作为外部唯一标识使用。
     */
    toJSON(): MarketplaceInfo;
}
//# sourceMappingURL=base-marketplace.d.ts.map