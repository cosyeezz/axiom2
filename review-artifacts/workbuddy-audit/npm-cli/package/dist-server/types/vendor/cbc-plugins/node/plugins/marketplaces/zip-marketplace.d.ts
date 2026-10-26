import { Logger } from '@genie/telemetry';
import { MarketplaceUpdatePreparation, ProgressCallback } from '../plugin-protocol';
import { DirectoryMarketplace } from './directory-marketplace';
/**
 * Reclaim temp roots left behind by processes killed mid download/extract: their
 * in-process `finally` never runs and nothing else scans the OS tmpdir (#119844).
 *
 * A root whose owner pid is in the name is removed as soon as that process is gone;
 * only roots without one (the daemon's ported copy, or an older CLI) wait out
 * {@link STALE_TEMP_ROOT_MIN_AGE_MS}. Best-effort: never throws.
 */
export declare function cleanupStaleZipMarketplaceTempRoots(options?: {
    root?: string;
    now?: number;
    logger?: Pick<Logger, 'debug'>;
}): Promise<number>;
/**
 * Marketplace source served as a ZIP / TGZ / TAR.GZ archive.
 *
 * Install flow:
 *   1. Download (or copy for local paths) the archive into an OS temp directory
 *   2. Extract into the same OS temp directory
 *   3. Read `marketplace.json` to determine the final marketplace name
 *   4. Atomically move the temp directory to `~/.codebuddy/plugins/marketplaces/<name>`
 *   5. Persist HTTP caching metadata (`.zip-metadata.json`) for future freshness checks
 *
 * Update flow mirrors install but preserves the existing installation until the
 * new extraction succeeds, so a failed update never corrupts a working copy.
 */
export declare class ZipMarketplace extends DirectoryMarketplace {
    /** ZIP archives are complete snapshots; copying the live tree is wasted IO. */
    get updateStagingMode(): 'empty';
    install(onProgress?: ProgressCallback): Promise<void>;
    checkForUpdate(onProgress?: ProgressCallback): Promise<MarketplaceUpdatePreparation>;
    update(onProgress?: ProgressCallback, preparation?: MarketplaceUpdatePreparation): Promise<boolean>;
    /** staging 实例的 name 不是市场身份，只有 declaredName 是（#119844）。 */
    private resolveIdentityName;
    /**
     * 当前 marketplace 是否为内置市场。
     * 仅在需要走 url-version 分支时判别，避免动到非内置市场的原有路径。
     */
    private getBuiltInVersionMetadata;
    /**
     * 首装成功后记录 Product versionUrl 或 ZIP URL 中的版本。只写入检查器
     * 已确认的 token；失败时保留完整安装并让下次后台刷新重试。
     */
    private seedVersionCache;
    /**
     * Try `downloadFile(url)`; on HTTP 404, attempt the alternate branch name
     * (main ↔ master) exactly once. Throws the original error if no fallback
     * applies or the fallback also fails.
     */
    private downloadWithBranchFallback;
    /**
     * Look for `marketplace.json` at the extraction root or inside the known
     * metadata directories (e.g. `.codebuddy-plugin/`, `.claude-plugin/`).
     */
    private readManifestFromDir;
    /** Same lookup as `readManifestFromDir`, but keeps the path so callers can rewrite it. */
    private readManifestEntryFromDir;
    /**
     * Every manifest copy that exists in the tree, in lookup order.
     *
     * Archives sometimes ship the manifest twice — at the extraction root and
     * inside a metadata directory — so that clients with different conventions
     * both find one. Readers disagree about which copy wins: this class checks
     * the root first, while `loadManifest` and `isMarketplaceMaterialized` only
     * ever look inside the metadata directories. Anything that rewrites a
     * manifest must therefore rewrite all of them.
     */
    private listManifestPaths;
    /**
     * Accept a freshly extracted archive as this marketplace's next snapshot.
     *
     * A published archive that declares a local plugin it does not ship is the
     * publisher's mistake, not a half-written local extraction: every retry
     * downloads the same incomplete bytes, so rejecting it strands the whole
     * marketplace — the remaining plugins become uninstallable and the
     * registry can never move to the declared source. Drop the unshipped
     * entries instead and keep the rest usable.
     *
     * Every manifest copy in the staged tree is pruned before it is published,
     * so the snapshot we install is internally consistent. Otherwise
     * `checkForUpdate`, which validates the installed snapshot strictly, would
     * rediscover the gap on every pass and re-download the same archive
     * forever, and a stale copy would keep `isMarketplaceMaterialized`
     * answering "not installed" for a marketplace that is in fact installed.
     *
     * Two conditions still reject the archive: entries that resolve outside
     * the archive or are not directories (integrity violations, #71947), and
     * archives missing more than the caps above allow.
     */
    private adoptDownloadedSnapshot;
    /** Drop entries pointing at `missingPaths` from one manifest copy on disk. */
    private pruneManifestFile;
    /** Whether a manifest entry points at one of the directories the archive omitted. */
    private declaresMissingPath;
    private assertValidManifest;
    /** Narrowing wrapper for callers that also need the manifest's path. */
    private assertValidManifestEntry;
    /**
     * Strict check for an already installed snapshot.
     *
     * Freshness metadata describes the whole extracted source snapshot, not
     * only marketplace.json. A process killed after publishing that manifest
     * but before every local plugin directory exists must not make the next
     * update return "current" forever. A local gap is always recoverable by
     * re-downloading, so nothing here is tolerated — unlike a freshly
     * downloaded archive, where `adoptDownloadedSnapshot` decides.
     */
    private assertCompleteSnapshot;
    /**
     * Walk the manifest's local plugin entries against the tree on disk.
     *
     * Absent directories are reported to the caller, which decides whether
     * they are tolerable. Entries that escape the archive root or are not
     * directories always throw: they are integrity violations rather than
     * missing content, and no caller may accept them.
     */
    private inspectLocalPlugins;
    /** Extract the archive URL from the marketplace source config. */
    private getZipUrl;
    /**
     * Derive a stable, filesystem-safe base name from a URL or local path.
     * Used as the temp directory prefix until the real name is read from the manifest.
     */
    private generateNameFromUrl;
    private slugify;
    private createTempRoot;
    private swapDirectoryFromTemp;
    private renameDirectory;
    /** Remove a path if it exists, silently ignoring any failure. */
    private safeRemove;
    /**
     * Sweep orphan transient artefacts from `marketplacesRoot`.
     *
     * An artefact is considered orphan when:
     *   1. Its name matches `<...>.<13-digit-ts>-<6-char-suffix>(.zip|.tmp)?` —
     *      i.e. the unique-suffix naming this class uses for downloads/extract dirs.
     *   2. The embedded timestamp is older than ORPHAN_ARTIFACT_MIN_AGE_MS, so we
     *      never touch temp files belonging to a concurrent install/update.
     *
     * Real marketplace install dirs (e.g. `cb_teams_marketplace`) never carry
     * the timestamp+random suffix, so they cannot match the pattern.
     *
     * Best-effort: any failure here must not affect the caller's install/update
     * result, which has already succeeded by the time we run.
     */
    private cleanupOrphanArtifacts;
}
//# sourceMappingURL=zip-marketplace.d.ts.map