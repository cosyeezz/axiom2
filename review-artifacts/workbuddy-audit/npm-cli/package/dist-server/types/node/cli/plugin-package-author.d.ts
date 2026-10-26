import type { AuthoredMod } from '../remote-gateway/mods/authored-mod-protocol';
declare global {
    var __CODEBUDDY_MOD_TEMPLATES__: Array<{
        name: string;
        path: string;
        filePath: string;
    }> | undefined;
}
export declare const MOD_PACKAGE_TEMPLATES: readonly ["host", "client", "dual", "bundle", "sidebar", "pet", "skin", "workbench"];
export type ModPackageTemplate = typeof MOD_PACKAGE_TEMPLATES[number];
export declare function pluginPackageName(name: string): {
    packageName: string;
    pluginName: string;
    toolPrefix: string;
};
/** Materializes a standalone package only; never installs, trusts or starts it. */
export declare function initPluginPackage(destination: string, options?: {
    name?: string;
    template?: ModPackageTemplate;
}): Promise<{
    root: string;
    name: string;
    template: ModPackageTemplate;
}>;
/** Builds a new portable directory; never overwrites source, evaluates modules or installs dependencies. */
export declare function buildPluginPackage(root: string, output?: string): Promise<{
    root: string;
    sourceHash: string;
    dependencies: {
        name: string;
        version: string;
    }[];
    name: string;
    plugin: string;
    version: string;
    hash: string;
    client: boolean;
    hostEntries: string[];
    bundle?: import("./plugin-package-bundle").PluginBundleMember[];
}>;
/** Export immutable source, not current runtime leases, grants, private KV or privileged authored wrappers. */
export declare function exportAuthoredPluginPackage(mod: AuthoredMod, destination: string, options?: {
    name?: string;
    version?: string;
    components?: import('../remote-gateway/mods/component-package').ComponentReader;
}): Promise<{
    root: string;
    sourceHash: string;
    name: string;
    plugin: string;
    version: string;
    hash: string;
    client: boolean;
    hostEntries: string[];
    bundle?: import("./plugin-package-bundle").PluginBundleMember[];
}>;
export declare function packPluginPackage(root: string, output?: string): Promise<{
    path: string;
    name: string;
    plugin: string;
    version: string;
    hash: string;
    client: boolean;
    hostEntries: string[];
    bundle?: import("./plugin-package-bundle").PluginBundleMember[];
}>;
