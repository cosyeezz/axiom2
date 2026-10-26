import { Mods, type PluginInfo } from '../../vendor/cbc-plugins/node/index.js';
import { type InstalledModApprovals } from '../remote-gateway/mods/mod-installed-approvals';
import { type InstalledHostModuleLoader } from './mods-installed-module-loader';
import { type IndexedModPackageSnapshot } from './plugin-package-version';
export interface InstalledHostSource extends Mods.BootstrapSource {
    readonly plugin: PluginInfo;
    readonly source: IndexedModPackageSnapshot;
}
/** Web function hooks use the same selected complete snapshot as their browser half. */
export declare function installedHostSource(root: string, deps: {
    plugins(): Promise<PluginInfo[]>;
    approvals: InstalledModApprovals;
    resourceRoot: string;
    log?(...args: unknown[]): void;
    signal?: AbortSignal;
    loader?: InstalledHostModuleLoader;
}): Promise<InstalledHostSource | undefined>;
