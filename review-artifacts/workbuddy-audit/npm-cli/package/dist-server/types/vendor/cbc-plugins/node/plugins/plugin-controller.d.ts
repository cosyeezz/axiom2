import { ConsoleManager } from '../../../../node/console/index.js';
import { Logger } from '@genie/telemetry';
import { PluginInstallOptions, PluginManager, PluginPruneOptions, PluginUninstallOptions, PluginValidator } from './plugin-protocol';
export interface PluginPathRequest {
    path: string;
}
export interface MarketplaceRequest {
    name?: string;
    source: string;
    /**
     * 强制更新：跳过 MarketplaceUpdateChecker 的 short-circuit，直接下载并覆盖
     * 目标市场目录。仅在 `/marketplace/update` 路由生效；`/marketplace/add` 忽略。
     *
     * 供已经用外部版本判据确认发生变化的调度方使用，避免再被本地 checker
     * 的 throttle 或缓存短路。
     */
    force?: boolean;
    /** 受管升级流程可显式要求同时刷新已安装插件；手动 Marketplace 更新默认不做。 */
    updateInstalledPlugins?: boolean;
}
export interface PluginActionRequest {
    plugin: string;
}
export interface PluginInstallRequest extends PluginActionRequest {
    options?: PluginInstallOptions;
}
export interface PluginUninstallRequest extends PluginActionRequest {
    options?: PluginUninstallOptions;
    scope?: string;
    prune?: boolean;
    keepData?: boolean;
    yes?: boolean;
}
export interface PluginPruneRequest extends Omit<PluginPruneOptions, 'scope'> {
    scope?: string;
    yes?: boolean;
}
export interface PluginListRequest {
    json?: boolean;
    print?: boolean;
}
export declare class PluginController {
    protected readonly pluginManager: PluginManager;
    protected readonly pluginValidator: PluginValidator;
    protected readonly logger: Logger;
    protected readonly consoleManager: ConsoleManager;
    validate(request: PluginPathRequest): Promise<any>;
    addMarketplace(request: MarketplaceRequest): Promise<any>;
    listMarketplaces(): Promise<any>;
    updateMarketplace(request: MarketplaceRequest): Promise<any>;
    removeMarketplace(request: any): Promise<void>;
    rmMarketplace(request: any): Promise<void>;
    installPlugins(request: PluginInstallRequest & {
        scope?: string;
    }): Promise<void>;
    uninstallPlugins(request: PluginUninstallRequest): Promise<void>;
    prunePlugins(request?: PluginPruneRequest): Promise<string[]>;
    enablePlugins(request: PluginActionRequest & {
        scope?: string;
    }): Promise<void>;
    disablePlugins(request: PluginActionRequest & {
        scope?: string;
    }): Promise<void>;
    updatePlugin(request: PluginActionRequest & {
        scope?: string;
    }): Promise<void>;
    listInstalledPlugins(request?: PluginListRequest): Promise<any>;
    getPlugin(request: any): Promise<any>;
    browseMarketplace(request: any): Promise<any>;
    private getMarketplaceTypeLabel;
    private getSourceInfo;
    private parsePluginId;
    private parseScope;
    private confirmRemoval;
    private getCliInstallScope;
    private formatInstalledPluginList;
}
//# sourceMappingURL=plugin-controller.d.ts.map