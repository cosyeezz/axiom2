import { MarketplaceInfo, MarketplaceType } from './plugin-protocol';
/** Stable code for a marketplace-relative path that resolves outside its root. */
export declare const MARKETPLACE_PATH_ESCAPE_ERROR_CODE = "PLUGIN_SOURCE_OUTSIDE_MARKETPLACE";
/**
 * Rejection of a marketplace-relative path (usually a plugin `source`) that
 * escapes its root. Hosts classify it by `code`; the message stays unchanged.
 */
export declare class MarketplacePathEscapeError extends Error {
    readonly relativePath: string;
    readonly code = "PLUGIN_SOURCE_OUTSIDE_MARKETPLACE";
    constructor(relativePath: string);
}
export declare function getMarketplacesRoot(homePluginsDir?: string): string;
/**
 * Require a single non-empty path segment. Unicode/spaces are allowed; unsafe
 * input is rejected rather than sanitized. Prefer {@link resolveMarketplaceInstallDir}
 * when you also need the directory; call this alone only to validate a name
 * without resolving a path (e.g. adopting an in-memory display name).
 */
export declare function assertSafePathSegment(value: unknown, label?: string): void;
/**
 * Plugin names used in `join(marketplaceRoot, 'plugins', name)` must be a
 * single safe identifier (same rule as Local/Git installers).
 */
export declare function assertSafePluginName(name: unknown): void;
/**
 * Resolve `segments` under `baseDir` and reject any path that escapes the root
 * (Zip Slip / `../` / absolute segments). By default the result must be a
 * strict child of `baseDir` (the root itself is not a valid install target).
 *
 * Pass `{ allowRoot: true }` for local plugin sources like `"."` / `"./"` where
 * the marketplace root is also the plugin root.
 */
export declare function resolveContainedPath(baseDir: string, ...segments: string[]): string;
/** Same as {@link resolveContainedPath}, but `"."` / `"./"` may resolve to `baseDir`. */
export declare function resolveContainedPathAllowingRoot(baseDir: string, ...segments: string[]): string;
/** Resolve `marketplaces/<name>` after a single segment check. Do not pre-assert. */
export declare function resolveMarketplaceInstallDir(marketplacesRoot: string, name: unknown): string;
/**
 * Persisted `installLocation` for non-directory marketplaces must stay inside
 * `plugins/marketplaces`. Poisoned config must fail closed — never delete or
 * update paths outside the root.
 */
export declare function assertInstallLocationInsideMarketplacesRoot(installLocation: string, marketplacesRoot?: string): void;
export declare function isInstallLocationInsideMarketplacesRoot(installLocation: string, marketplacesRoot?: string): boolean;
/**
 * Resolve existing paths (or the nearest existing ancestor) via realpath and
 * ensure the final target stays inside the marketplaces root. Blocks
 * symlink/junction escapes that string containment alone would miss.
 *
 * Fail-closed: only ENOENT walks to a parent (first install / missing dest).
 * EACCES, ELOOP, and other realpath failures refuse the operation.
 */
export declare function assertRealInstallLocationInsideMarketplacesRoot(installLocation: string, marketplacesRoot?: string): Promise<void>;
export declare function isDirectoryMarketplaceType(type: MarketplaceType | string | undefined): boolean;
export declare function isGeneratedMarketplaceSourceStagingName(name: string): boolean;
/** Resolve the one durable source directory for a managed marketplace. */
export declare function resolveStableMarketplaceInstallLocation(marketplace: Pick<MarketplaceInfo, 'name' | 'storageName'>, homePluginsDir?: string): string;
/**
 * Detect the layout accidentally persisted by older clients after they used a
 * transaction-local `source-*` directory as the final marketplace directory.
 */
export declare function isLegacyMarketplaceSourceStagingLocation(marketplace: Pick<MarketplaceInfo, 'type' | 'source' | 'installLocation'>, homePluginsDir?: string): boolean;
/**
 * Check whether a persisted remote marketplace points at a complete local
 * source snapshot.
 *
 * Directory marketplaces are declarations of a host-owned live directory,
 * not copied source snapshots. Keep their registry entry even while that
 * directory is temporarily unavailable so already-materialized plugin caches
 * remain usable. Remote marketplaces, however, must have a readable catalog and every
 * catalog-local plugin directory before reconcile may call them installed.
 */
export declare function isMarketplaceMaterialized(info: Pick<MarketplaceInfo, 'type' | 'source' | 'installLocation'>, marketplacesRoot?: string): Promise<boolean>;
/**
 * Non-directory marketplaces may only persist install paths under marketplaces root.
 * Uses realpath so a junction/symlink that only *looks* contained is still rejected (#71947).
 */
export declare function isLoadableInstallLocation(info: {
    type?: MarketplaceType | string;
    source?: {
        source?: string;
    };
    installLocation?: string;
}, marketplacesRoot: string): Promise<boolean>;
/**
 * Refuse to persist a non-directory marketplace whose installLocation escapes the
 * marketplaces root — including via symlink/junction (#71947).
 */
export declare function assertSavableInstallLocation(marketplace: {
    name: string;
    type?: MarketplaceType | string;
    source?: {
        source?: string;
    };
    installLocation?: string;
}, marketplacesRoot?: string): Promise<void>;
//# sourceMappingURL=marketplace-path-safety.d.ts.map