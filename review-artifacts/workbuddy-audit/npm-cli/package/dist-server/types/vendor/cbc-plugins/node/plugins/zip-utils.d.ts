import { Logger } from '@genie/telemetry';
import type { IncomingHttpHeaders } from 'http';
/**
 * 从 zip URL 里提取 UUID 版本号，用于内置市场更新检查。
 *
 * 命中规则：URL basename 必须是 `<name>-<UUID>.zip`，UUID 形如
 *     `cb_teams_marketplace-e4456ec2-6d1a-4af9-86a9-83a4bea4bbda.zip`
 * 只接受标准 UUID v4 字面量（8-4-4-4-12），不做其他兜底解析；解析失败返回
 * `null`，由调用方决定是否走 ETag 兜底。
 *
 * 外部更新调度与 CLI checker 必须共用本函数；同一个 URL 若被解析成不同版本，
 * 两层更新判据会出现无限震荡。
 */
export declare function parseVersionFromUrl(url: string): string | null;
/**
 * ZIP metadata persisted after a successful install/update.
 * Used to decide whether a remote source has new content without re-downloading the archive.
 */
export interface ZipMetadata {
    /** Source URL or local file path this archive came from. */
    url: string;
    /** Last-Modified header value returned by the server (or local file mtime). */
    lastModified?: string;
    /** ETag header value returned by the server. */
    etag?: string;
    /** ISO timestamp of when this archive was downloaded. */
    downloadedAt: string;
    /**
     * Indicates the install/extract step finished without error.
     * Absent on legacy metadata, which we treat as "unverified" and trigger re-download.
     */
    installComplete?: boolean;
}
/** Headers captured from a successful download response. */
export interface DownloadResult {
    lastModified?: string;
    etag?: string;
}
/** Result of a freshness check against a remote (or local) archive source. */
export interface ZipUpdateCheckResult {
    needsUpdate: boolean;
    lastModified?: string;
    etag?: string;
}
/** Resolve the metadata path for a given install location. */
export declare function getMetadataPath(installLocation: string): string;
/** Read metadata if it exists; returns undefined on any read/parse error. */
export declare function readZipMetadata(installLocation: string): Promise<ZipMetadata | undefined>;
/** Write metadata to the install location. */
export declare function writeZipMetadata(installLocation: string, metadata: ZipMetadata): Promise<void>;
/** A "local file path" is anything that isn't an HTTP or HTTPS URL. */
export declare function isLocalFilePath(source: string): boolean;
/** Detect whether a URL points to a ZIP/TGZ/TAR.GZ archive by extension. */
export declare function isZipUrl(url: string): boolean;
/**
 * Fetch headers via HEAD request, following up to `maxRedirects` redirects.
 * Some hosts (e.g. git archive URLs) reject HEAD; callers should fall back to
 * treating that as "needs update" rather than a hard failure.
 */
export declare function getRemoteHeaders(url: string, maxRedirects?: number): Promise<IncomingHttpHeaders>;
/** Fetch a small UTF-8 version token with bounded connect/read time and size. */
export declare function fetchText(url: string, timeoutMs?: number, maxRedirects?: number): Promise<string>;
/** Download an archive and capture its HTTP freshness metadata. */
export declare function downloadFile(url: string, destPath: string, maxRedirects?: number): Promise<DownloadResult>;
/** Copy a local archive to a destination path; mirrors downloadFile's return shape. */
export declare function copyLocalFile(sourcePath: string, destPath: string): Promise<DownloadResult>;
/**
 * Decide whether a remote ZIP needs to be re-downloaded by comparing ETag/Last-Modified.
 *
 * The precedence mirrors `agent-craft`'s implementation:
 *   1. No existing metadata → update (first install)
 *   2. `installComplete` flag missing → update (legacy or interrupted install)
 *   3. URL changed → update
 *   4. ETag available on both sides → trust ETag equality
 *   5. Last-Modified available on both sides → compare timestamps
 *   6. HEAD request failed or server returns neither header → update (safe default)
 */
export declare function checkZipNeedsUpdate(url: string, installLocation: string, maxRedirects?: number): Promise<ZipUpdateCheckResult>;
/** Decide whether a local-path ZIP has changed since last install by comparing mtime. */
export declare function checkLocalZipNeedsUpdate(sourcePath: string, installLocation: string): Promise<ZipUpdateCheckResult>;
/**
 * Extract a ZIP / TGZ / TAR.GZ archive to `targetDir`.
 *
 * @param flatten When a single top-level directory is detected in a .zip (common for
 *   `git archive` output), move its contents up one level. Ignores `__MACOSX`.
 *   Defaults to true.
 */
export declare function extractZip(zipPath: string, targetDir: string, flatten?: boolean, logger?: Pick<Logger, 'warn'>): Promise<void>;
//# sourceMappingURL=zip-utils.d.ts.map