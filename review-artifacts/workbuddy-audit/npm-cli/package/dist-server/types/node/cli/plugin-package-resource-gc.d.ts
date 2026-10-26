export interface RetainedPluginSnapshot {
    sourceHash: string;
    indexHash: string;
    format?: 1 | 2;
}
export interface PluginSnapshotCollection {
    indexes: number;
    objects: number;
    bytes: number;
    retained: number;
    ignored: number;
}
/** All roots are read fresh under the same cross-process lock as publication and approval binding. */
export declare function collectPluginSnapshots(resourceRoot: string, roots: () => Promise<readonly RetainedPluginSnapshot[]>, locks: {
    acquireLock(name: string): Promise<() => Promise<void>>;
}, signal?: AbortSignal): Promise<PluginSnapshotCollection>;
/** Publication may reclaim before its single retry while already holding the shared write lock. */
export declare function collectPluginSnapshotsUnderLock(resourceRoot: string, roots: () => Promise<readonly RetainedPluginSnapshot[]>, signal?: AbortSignal): Promise<PluginSnapshotCollection>;
