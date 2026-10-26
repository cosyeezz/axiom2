import { type MarketplaceProviders } from '../marketplace-provider';
import { type MarketplacePluginEntry, type PluginSource, type ProgressCallback } from '../plugin-protocol';
import { ArchivePluginInstaller } from './archive-plugin-installer';
export declare class ProviderPluginInstaller extends ArchivePluginInstaller {
    providers: MarketplaceProviders;
    support(source: string | PluginSource): boolean;
    install(entry: MarketplacePluginEntry, targetDir: string, progress?: ProgressCallback): Promise<string>;
}
//# sourceMappingURL=provider-plugin-installer.d.ts.map