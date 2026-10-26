import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { MarketplaceNeedsUpdateResult, MarketplaceUpdateChecker } from '../plugin-protocol';
/**
 * Default implementation of {@link MarketplaceUpdateChecker}.
 *
 * Check order (first decisive signal wins):
 *   1. mtime throttle — if the version file was touched recently, skip remote calls
 *   2. urlVersion (由调用方从 zipUrl 解析得到) — 本地版本号字符串比对，
 *      不发起任何 HTTP；所有调度方共用 `parseVersionFromUrl`，避免两层更新
 *      判据不一致。
 *   3. versionUrl (Product metadata) — fetch a small remote version token
 *   4. ETag / Last-Modified (HEAD on the zip URL) — 兜底路径，覆盖用户自定义市场
 *      及 url 不带 UUID 段的内置市场。
 *
 * urlVersion 必须排在 versionUrl 之前（#38676 的原始顺序）：前者与下载到的字节同源，
 * 后者是另一条间接指向，宿主把两者拼进同一条声明时会分别指向不同的包（#119844）。
 *
 * This service is a Singleton so its throttle map lives across marketplace transient instances.
 */
export declare class MarketplaceUpdateCheckerImpl implements MarketplaceUpdateChecker {
    protected readonly logger: Logger;
    protected readonly productManager: ProductManager;
    protected init(): void;
    needsUpdate(args: {
        marketplaceName: string;
        installLocation: string;
        zipUrl: string;
        versionUrl?: string;
        urlVersion?: string;
    }): Promise<MarketplaceNeedsUpdateResult>;
    commitVersion(marketplaceName: string, installLocation: string, version: string): Promise<void>;
    invalidateCache(marketplaceName: string, installLocation: string): Promise<void>;
    protected fetchRemoteVersion(versionUrl: string): Promise<string>;
    private isRecentlyChecked;
    private touchVersionFile;
    private readCachedVersion;
    private hasZipMetadata;
    private classifyHttpCheck;
    private getCheckIntervalMs;
}
//# sourceMappingURL=marketplace-update-checker.d.ts.map