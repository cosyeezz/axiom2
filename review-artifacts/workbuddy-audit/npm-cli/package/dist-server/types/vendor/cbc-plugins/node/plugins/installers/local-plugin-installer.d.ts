import { MarketplacePluginEntry, PluginErrorCollector, PluginInstaller, PluginSource, ProgressCallback } from '../plugin-protocol';
/**
 * 本地相对路径插件安装器
 * 处理source.source === 'local'的插件
 */
export declare class LocalPluginInstaller implements PluginInstaller {
    protected readonly errorCollector: PluginErrorCollector;
    /**
     * 判断是否支持该插件源
     * 支持:
     * 1. 字符串类型source(视为本地相对路径)
     * 2. PluginSource对象且source === 'local'
     */
    support(pluginSource: string | PluginSource): boolean;
    /**
     * 安装本地插件
     * 本地插件无需实际安装,只需解析路径
     */
    install(pluginEntry: MarketplacePluginEntry, targetDir: string, onProgress?: ProgressCallback): Promise<string>;
    /**
     * 更新本地插件
     * 本地插件无需更新,直接返回路径
     */
    update(pluginEntry: MarketplacePluginEntry, installedPath: string, onProgress?: ProgressCallback): Promise<string>;
    /**
     * 检查本地插件是否已安装(已解析)
     */
    isInstalled(pluginEntry: MarketplacePluginEntry, marketplaceInstalledPath: string): Promise<string | undefined>;
    /**
     * 解析插件的实际路径
     * 支持两种路径模式:
     * 1. 直接指向插件根目录: targetDir/path（含 "." / "./" = 市场根本身）
     * 2. 指向插件的父目录: targetDir/path/pluginName
     */
    private resolvePluginPath;
    /**
     * 标准化插件源为PluginSource对象
     */
    private normalizeSource;
}
//# sourceMappingURL=local-plugin-installer.d.ts.map