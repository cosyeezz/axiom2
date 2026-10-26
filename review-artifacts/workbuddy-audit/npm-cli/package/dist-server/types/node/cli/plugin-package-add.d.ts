import { type MarketplacePluginEntry, type PluginInstallScope, type PluginManager } from '../../vendor/cbc-plugins/node/index.js';
export interface PluginPackageAddRequest {
    package: string;
    profile?: 'web';
    registry?: string;
    scope?: PluginInstallScope;
    enable?: boolean;
    yes?: boolean;
    ref?: string;
    sha?: string;
    subdir?: string;
    /** Internal product target; Web Mods installation must not install an ordinary Skill/MCP plugin. */
    modOnly?: boolean;
}
export interface PluginPackageAddResult {
    package: string;
    version: string;
    pluginId: string;
    enabled: boolean;
    source: string;
    hash: string;
    sourceKind: 'npm' | 'git' | 'local' | 'archive';
    sourceSpec: string;
    bundle?: Array<{
        pluginId: string;
        enabled: boolean;
        client: boolean;
        layers: string[];
        resourceSnapshot?: import('./plugin-package-resources').PluginResourceReceipt;
    }>;
    resourceSnapshot?: import('./plugin-package-resources').PluginResourceReceipt;
}
interface Installer {
    install(entry: MarketplacePluginEntry, target: string, progress?: (message: string) => void): Promise<string>;
}
export interface PluginPackageAddDependencies {
    downloadNpm?: (name: string, selector: string, target: string, registry?: string, progress?: (message: string) => void) => Promise<string>;
    gitInstaller?: Installer;
    gitSubdirInstaller?: Installer;
    localInstaller?: Installer;
    plugins: Pick<PluginManager, 'addMarketplace' | 'installPlugins' | 'enablePlugins'>;
    configDir: string;
    acquireLock(name: string): Promise<() => Promise<void>>;
    confirm(message: string): Promise<boolean>;
    approveWeb?(pluginId: string, hash: string): Promise<void>;
    retainedResources?(): Promise<readonly import('./plugin-package-resource-gc').RetainedPluginSnapshot[]>;
    log(message: string): void;
}
/** npm package identity and selector, distinct from the older name@marketplace syntax. */
export declare function parsePluginPackageSpec(input: string): {
    name: string;
    selector: string;
};
/** Download never executes package scripts; existing PluginManager owns the committed installation. */
export declare function addPluginPackage(request: PluginPackageAddRequest, deps: PluginPackageAddDependencies): Promise<PluginPackageAddResult>;
export {};
