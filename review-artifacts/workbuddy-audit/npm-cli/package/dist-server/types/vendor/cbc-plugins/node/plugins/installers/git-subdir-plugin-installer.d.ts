import { Logger } from '@celljs/core';
import { MarketplacePluginEntry, PluginInstaller, PluginSource } from '../plugin-protocol';
/**
 * Git 子目录插件安装器
 * 使用 git sparse checkout 从 monorepo 的子目录安装插件
 * 避免全量克隆整个仓库
 *
 * 参考: Claude Code schemas.ts:1131-1157
 */
export declare class GitSubdirPluginInstaller implements PluginInstaller {
    protected readonly logger: Logger;
    protected init(): void;
    support(pluginSource: string | PluginSource): boolean;
    install(pluginEntry: MarketplacePluginEntry, targetDir: string, onProgress?: (message: string) => void): Promise<string>;
    update(pluginEntry: MarketplacePluginEntry, installedPath: string, onProgress?: (message: string) => void): Promise<string>;
    isInstalled(pluginInfo: MarketplacePluginEntry, marketplaceInstalledPath: string): Promise<string | undefined>;
    private validateGitSha;
    private getValidatedSubdir;
}
//# sourceMappingURL=git-subdir-plugin-installer.d.ts.map