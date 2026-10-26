import { type PluginPackageFiles } from './plugin-package-files';
/** Uses the installed tar-stream parser; no scripts, arbitrary extraction paths or custom tar parser. */
export declare function extractPluginPackageArchive(archive: string, destination: string): Promise<string>;
export declare function packPluginPackageArchive(source: PluginPackageFiles, output: string): Promise<void>;
