import { type MarketplacePluginEntry } from '../../vendor/cbc-plugins/node/index.js';
export interface PluginBundleNode {
    path: string;
    enabled?: boolean;
    /** A later layer replaces the whole options object, not individual keys. */
    options?: Record<string, string | number | boolean | string[]>;
}
export interface PluginBundleDeclaration {
    version: 1;
    layers: Array<{
        name: string;
        plugins: PluginBundleNode[];
    }>;
    lock?: {
        version: 1;
        members: Array<{
            path: string;
            name: string;
            version: string;
            hash: string;
            enabled: boolean;
        }>;
    };
}
export interface PluginBundleMember {
    name: string;
    version: string;
    path: string;
    enabled: boolean;
    client: boolean;
    hash: string;
    layers: string[];
    options: Record<string, string | number | boolean | string[]>;
}
export declare function parsePluginBundle(value: unknown): PluginBundleDeclaration;
/** Compose data in an inert download snapshot. PluginManager remains the only install/enable authority. */
export declare function preparePluginBundle(root: string, manifest: Record<string, unknown>, materialize?: boolean): Promise<PluginBundleMember[]>;
/** Only after checked deliberate composition/build changes; never repair a mismatched input lock. */
export declare function lockPluginBundle(declaration: PluginBundleDeclaration, members: readonly PluginBundleMember[]): PluginBundleDeclaration;
export declare function pluginBundleCatalog(manifest: Record<string, unknown>, members: PluginBundleMember[], version: string, hash: string): MarketplacePluginEntry[];
