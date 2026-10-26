export interface PluginPackageFiles {
    files: ReadonlyMap<string, Buffer>;
    hash: string;
    root: string;
}
export { PLUGIN_PACKAGE_LIMITS } from './plugin-package-limits';
/** Match the source walk's directory-first component ordering, including dotted sibling names. */
export declare function pluginPackageFingerprint(files: ReadonlyMap<string, Buffer>): string;
/** One bounded, symlink-free source snapshot. Ignored dependency/runtime trees are not distributable source. */
export declare function readPluginPackageFiles(root: string): Promise<PluginPackageFiles>;
export declare function packageJson(files: ReadonlyMap<string, Buffer>, name: string): Record<string, unknown>;
/** Compile only. Neither module initialization nor register/apply runs during build/pack. */
export declare function inspectPluginPackage(source: PluginPackageFiles): Promise<{
    name: string;
    plugin: string;
    version: string;
    hash: string;
    client: boolean;
    hostEntries: string[];
    bundle?: import('./plugin-package-bundle').PluginBundleMember[];
}>;
