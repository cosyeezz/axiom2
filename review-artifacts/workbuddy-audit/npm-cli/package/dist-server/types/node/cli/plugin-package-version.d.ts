import { type ModPackageSnapshot } from '../remote-gateway/mods/mod-package-snapshot';
interface VersionFile {
    path: string;
    digest: string;
    bytes: number;
}
interface VersionIndex {
    format: 2;
    sourceHash: string;
    files: VersionFile[];
}
export interface PluginVersionReceipt {
    format: 2;
    sourceHash: string;
    indexHash: string;
    files: number;
    bytes: number;
}
export interface IndexedModPackageSnapshot extends ModPackageSnapshot {
    sealed: {
        indexHash: string;
        hasHost: boolean;
        nativeFiles: boolean;
    };
    readText(path: string, maxBytes: number): Promise<string>;
}
/** Capture every source byte once. Approval subsequently selects this full version, not its mutable origin. */
export declare function snapshotPluginPackageVersion(root: string, resourceRoot: string, expectedHash: string, locks: {
    acquireLock(name: string): Promise<() => Promise<void>>;
}, publish?: (receipt: PluginVersionReceipt) => Promise<void>, reclaim?: () => Promise<void>): Promise<PluginVersionReceipt>;
/** Read only selected immutable objects from an index anchored in private source approval. */
export declare function readIndexedModPackage(root: string, resourceRoot: string, receipt: Pick<PluginVersionReceipt, 'sourceHash' | 'indexHash'>, retain?: (path: string) => boolean, signal?: AbortSignal): Promise<IndexedModPackageSnapshot>;
export declare function readPluginVersionIndex(resourceRoot: string, receipt: Pick<PluginVersionReceipt, 'sourceHash' | 'indexHash'>, signal?: AbortSignal): Promise<VersionIndex>;
export declare function hasNativePackageFiles(manifest: Record<string, unknown>, paths: Iterable<string>): boolean;
export declare function functionHookSnapshot(source: IndexedModPackageSnapshot): boolean;
export {};
