import { Logger } from '@celljs/core';
import { MarketplacePluginEntry, PluginInstaller, PluginSource } from '../plugin-protocol';
/**
 * npm 安装的可选策略。缺省保持历史行为（npm 默认执行生命周期脚本）；
 * 只有调用方显式要求时才追加 `--ignore-scripts`。
 */
export interface NpmPluginInstallOptions {
    /** true 时追加 `--ignore-scripts`，下载包但不执行其 install/postinstall 脚本。 */
    ignoreScripts?: boolean;
}
/**
 * npm 插件安装器
 * 通过 npm install 安装插件包到指定目录
 *
 * 参考: Claude Code schemas.ts:974-1050
 */
export declare class NpmPluginInstaller implements PluginInstaller {
    protected readonly logger: Logger;
    protected init(): void;
    support(pluginSource: string | PluginSource): boolean;
    install(pluginEntry: MarketplacePluginEntry, targetDir: string, onProgress?: (message: string) => void, options?: NpmPluginInstallOptions): Promise<string>;
    update(pluginEntry: MarketplacePluginEntry, installedPath: string, onProgress?: (message: string) => void): Promise<string>;
    isInstalled(pluginInfo: MarketplacePluginEntry, marketplaceInstalledPath: string): Promise<string | undefined>;
    /** Fail-closed: package name must be a valid npm id (scoped ok); never a path. */
    private resolvePackageName;
    /**
     * Resolve `node_modules/<package>` under the install dir. Scoped names become
     * two segments (`@scope`, `name`); containment rejects any escape (#71947).
     */
    private resolvePackageDir;
}
//# sourceMappingURL=npm-plugin-installer.d.ts.map