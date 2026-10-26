interface ResourceEntry {
    path: string;
    digest: string;
    bytes: number;
    mime: string;
}
interface ResourceIndex {
    format: 1;
    sourceHash: string;
    resources: ResourceEntry[];
}
export interface PluginResourceReceipt {
    format: 1;
    sourceHash: string;
    indexHash: string;
    files: number;
    bytes: number;
}
/** Derive a resource index only from a verified complete package. The receipt is not an approval grant. */
export declare function snapshotPluginPackageResources(packageRoot: string, resourceRoot: string, expectedHash: string, locks: {
    acquireLock(name: string): Promise<() => Promise<void>>;
}, reclaim?: () => Promise<void>): Promise<PluginResourceReceipt>;
/** Caller holds the shared snapshot write lock; only verified source objects enter this publisher. */
export declare function publishPluginSnapshot(resourceRoot: string, text: string, objects: ReadonlyMap<string, Buffer>, reclaim?: () => Promise<void>): Promise<string>;
/** Verify stored bytes against the caller's independently trusted digest, never against their filename alone. */
export declare function readPluginSnapshotObject(resourceRoot: string, kind: 'objects' | 'indexes', hash: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer>;
/** The caller supplies an independently trusted receipt, not a hash read from the index being checked. */
export declare function readPluginPackageResource(resourceRoot: string, receipt: Pick<PluginResourceReceipt, 'format' | 'sourceHash' | 'indexHash'>, path: string, signal?: AbortSignal): Promise<{
    bytes: Buffer;
    mime: string;
}>;
export declare function readPluginResourceIndex(resourceRoot: string, receipt: Pick<PluginResourceReceipt, 'sourceHash' | 'indexHash'>, signal?: AbortSignal): Promise<ResourceIndex>;
export {};
