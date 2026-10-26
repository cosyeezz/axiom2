import { MarketplacePluginEntry, PluginErrorCollector, PluginInstaller, PluginSource, ProgressCallback } from '../plugin-protocol';
/**
 * Git远程仓库插件安装器
 * 处理source.source === 'url'的插件
 */
export declare class GitPluginInstaller implements PluginInstaller {
    protected readonly errorCollector: PluginErrorCollector;
    /**
     * 判断是否支持该插件源
     * 支持: PluginSource对象且source === 'url' 或 'github'
     */
    support(pluginSource: string | PluginSource | undefined): boolean;
    /**
     * 安装Git远程插件
     * 克隆Git仓库到指定目录
     */
    install(pluginEntry: MarketplacePluginEntry, targetDir: string, onProgress?: ProgressCallback): Promise<string>;
    /**
     * 更新已安装的Git插件
     * 执行git pull更新内容
     */
    update(pluginEntry: MarketplacePluginEntry, installedPath: string, onProgress?: ProgressCallback): Promise<string>;
    /**
     * 检查Git插件是否已安装
     */
    isInstalled(pluginEntry: MarketplacePluginEntry, marketplaceInstalledPath: string): Promise<string | undefined>;
    /**
     * 获取插件的当前版本信息(commit hash)
     */
    getInstalledVersion(installedPath: string): Promise<string | undefined>;
    /**
     * 获取插件的远程URL
     */
    getRemoteUrl(installedPath: string): Promise<string | undefined>;
    /**
     * 从PluginSource解析实际的Git URL
     * @param source 插件源配置
     * @returns Git URL
     */
    private resolveGitUrl;
    private validateGitSha;
}
//# sourceMappingURL=git-plugin-installer.d.ts.map