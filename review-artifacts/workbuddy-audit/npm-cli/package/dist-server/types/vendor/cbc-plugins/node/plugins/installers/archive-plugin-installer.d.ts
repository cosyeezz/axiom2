import { Logger } from '@genie/telemetry';
import { type MarketplacePluginEntry, PluginInstaller, type PluginSource, type ProgressCallback } from '../plugin-protocol';
/** Preparation only. PluginManager owns the temporary directory, immutable cache and registry commit. */
export declare class ArchivePluginInstaller implements PluginInstaller {
    protected readonly logger: Logger;
    support(source: string | PluginSource): boolean;
    protected fetchRemote(url: string, options: {
        signal: AbortSignal;
    }): Promise<Response>;
    install(entry: MarketplacePluginEntry, targetDir: string, progress?: ProgressCallback): Promise<string>;
    protected installArchive(entry: MarketplacePluginEntry, targetDir: string, download: (url: string, options: {
        signal: AbortSignal;
    }) => Promise<Response>, progress?: ProgressCallback): Promise<string>;
    protected verifyManifest(entry: MarketplacePluginEntry, directory: string): Promise<void>;
    update(entry: MarketplacePluginEntry, installedPath: string, progress?: ProgressCallback): Promise<string>;
    isInstalled(): Promise<undefined>;
}
//# sourceMappingURL=archive-plugin-installer.d.ts.map