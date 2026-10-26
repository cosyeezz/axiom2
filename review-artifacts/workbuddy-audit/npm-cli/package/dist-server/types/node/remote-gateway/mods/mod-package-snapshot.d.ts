export interface ModPackageSnapshot {
    root: string;
    hash: string;
    paths: Set<string>;
    files: Map<string, Buffer>;
    manifest: Record<string, unknown>;
}
/** Hash every source byte in the existing name/base64 format, retaining only the requested working set. */
export declare function readModPackageSnapshot(root: string, retain?: (path: string) => boolean, signal?: AbortSignal): Promise<ModPackageSnapshot>;
