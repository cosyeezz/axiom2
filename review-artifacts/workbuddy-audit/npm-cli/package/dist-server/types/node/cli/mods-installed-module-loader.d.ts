import { Mods } from '../../vendor/cbc-plugins/node/index.js';
interface SelectedModule {
    fingerprint: string;
    indexHash: string;
    resourceRoot: string;
    check(): Promise<void>;
    signal?: AbortSignal;
}
/** One process budget for selected Web hook snapshots, independent of browser request queues. */
export declare class InstalledHostModuleLoader {
    private readonly work;
    private readonly compilations;
    private outstanding;
    private readonly compiled;
    source<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T>;
    importer(fs: Mods.ModFileSystem, selection: SelectedModule): Mods.ModuleImporter;
    private resource;
}
export declare const installedHostModuleLoader: InstalledHostModuleLoader;
export {};
