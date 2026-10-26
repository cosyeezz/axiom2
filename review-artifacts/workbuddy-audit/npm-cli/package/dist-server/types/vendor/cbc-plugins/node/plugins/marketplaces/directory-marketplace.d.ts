import { PluginInfo, ProgressCallback } from '../plugin-protocol';
import { BaseMarketplace } from './base-marketplace';
/**
 * 目录类型的市场实现类
 */
export declare class DirectoryMarketplace extends BaseMarketplace {
    private pluginListCache?;
    private pluginListLoading?;
    private pluginListGeneration;
    clearPluginListCache(): void;
    install(onProgress?: ProgressCallback): Promise<void>;
    /**
     * 列出市场中的所有插件
     */
    listPlugins(): Promise<PluginInfo[]>;
    private listCurrentPlugins;
    private loadPluginList;
    private findPluginManifestPath;
    private clonePlugins;
}
//# sourceMappingURL=directory-marketplace.d.ts.map