import { Logger } from '@genie/telemetry';
import { PluginInstallStatsService } from './plugin-protocol';
/**
 * Plugin install stats service implementation
 * Fetches and caches plugin installation statistics from remote
 */
export declare class PluginInstallStatsServiceImpl implements PluginInstallStatsService {
    protected readonly logger: Logger;
    private memoryCache;
    private memoryCacheTimestamp;
    private fetchPromise;
    private cacheFilePath;
    constructor();
    protected init(): void;
    fetchInstallStats(): Promise<Map<string, number>>;
    private doFetch;
    private loadFromFileCache;
    private saveToFileCache;
    getInstallCount(pluginName: string): Promise<number | undefined>;
}
//# sourceMappingURL=plugin-install-stats-service.d.ts.map