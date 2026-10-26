import { Logger } from '@celljs/core';
import { PluginEnvironmentContext } from '../plugin-environment';
import { PluginOptionsStorage } from '../plugin-options-storage';
import { LspServerConfig, PluginExtensionType } from '../plugin-protocol';
/**
 * LSP 服务器加载器
 * 从扩展目录中加载 LSP 服务器配置
 * 支持配置路径和默认扫描的合并
 */
export declare class LSPExtensionLoader {
    readonly type = PluginExtensionType.LSP;
    protected readonly logger: Logger;
    protected readonly pluginOptionsStorage?: PluginOptionsStorage;
    protected init(): void;
    /**
     * 加载 LSP 服务器配置
     * 如果提供了 lspConfig 配置,则加载指定配置;否则默认扫描 .lsp.json
     * 如果 plugin.json 中配置了 lspServers,优先使用该配置,忽略 .lsp.json
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称(用于标记)
     * @param lspConfig 可选的 LSP 配置,可以是文件路径或直接的配置对象
     * @returns LSP 服务器配置对象
     */
    load(extensionDir: string, extensionName: string, lspConfig?: string | Record<string, LspServerConfig>, pluginEnvironment?: PluginEnvironmentContext): Promise<Record<string, LspServerConfig>>;
    /**
     * 从配置加载 LSP 服务器
     * @param extensionDir 扩展目录路径
     * @param extensionName 扩展名称
     * @param lspConfig LSP 配置,可以是文件路径或直接的配置对象
     * @returns LSP 服务器配置对象
     */
    private loadFromConfig;
    /**
     * 从 .lsp.json 配置文件加载 LSP 服务器
     */
    private loadFromConfigFile;
    private pathExists;
    /**
     * 解析 LSP 服务器配置文件
     */
    private parseServerConfigFile;
    private enrichWithPluginEnvironment;
    /**
     * 验证 LSP 配置
     */
    private validateConfigs;
}
//# sourceMappingURL=lsp-loader.d.ts.map