import type { DataFs } from '../../../../node/data-fs/index.js';
type ProjectionFs = Pick<DataFs, 'readFile' | 'readdir' | 'realpath' | 'lstat'>;
/** Resolve only a complete engine projection, never a marker on its own. */
export declare function readDirectoryPluginCacheProjectionSource(targetDir: string, filesystem?: ProjectionFs): Promise<string | undefined>;
export declare function isCurrentDirectoryPluginCacheProjection(targetDir: string, sourceDir: string, filesystem?: ProjectionFs): Promise<boolean>;
export declare function replaceWithDirectoryPluginCacheProjection(sourceDir: string, targetDir: string, cacheRoot: string): Promise<boolean>;
export {};
//# sourceMappingURL=directory-plugin-cache-projection.d.ts.map