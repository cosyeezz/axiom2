import { CliSettingSourcesProvider } from '../../../../../node/settings/cli-setting-sources-provider.js';
import { SettingsManager } from '../../../../../node/settings/settings-protocol.js';
import { Logger } from '@genie/telemetry';
import { MarketplaceConfigManager, MarketplaceSource, MarketplaceStorage, MarketplaceToInstall } from '../plugin-protocol';
/**
 * 市场配置管理器
 * 负责从 settings 中读取 extraKnownMarketplaces 配置,
 * 并识别需要安装的市场
 */
export declare class MarketplaceConfigManagerImpl implements MarketplaceConfigManager {
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly cliSettingSourcesProvider: CliSettingSourcesProvider;
    protected readonly marketplaceStorage: MarketplaceStorage;
    protected init(): void;
    /**
     * 获取所有配置的市场(按 user → project → local → CLI 顺序合并，后者覆盖前者)
     *
     * 各 scope 受 `--setting-sources` 约束(isScopeAllowed：文件系统 scope 需在
     * sources 里，CLI 来自 `--settings` 显式注入、恒允许)，避免 SDK/隔离环境
     * 仍被本机 settings 注入市场。
     */
    getConfiguredMarketplaces(options?: {
        includeSession?: boolean;
        workspacePath?: string;
    }): Promise<Map<string, MarketplaceSource>>;
    private getConfiguredMarketplaceDeclarations;
    /**
     * 获取需要安装的市场列表
     */
    getMarketplacesToInstall(options?: {
        workspacePath?: string;
    }): Promise<MarketplaceToInstall[]>;
    /**
     * 合并市场配置到 Map 中
     */
    private mergeMarketplaceConfig;
    private readWorkspaceMarketplaceConfig;
    /**
     * 验证市场源配置的有效性
     */
    private validateMarketplaceSource;
}
//# sourceMappingURL=marketplace-config-manager.d.ts.map