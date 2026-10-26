import { type PluginPackageFiles } from './plugin-package-files';
export declare function compilePluginDistribution(source: PluginPackageFiles): Promise<{
    files: Map<string, Buffer>;
    dependencies: Array<{
        name: string;
        version: string;
    }>;
}>;
