import type { PlatformPath } from 'node:path';
import type { ModuleImporter } from './load-mod';
import type { ModBundle } from './mod-compiler';
export interface ModFileSystem {
    readText(path: string): Promise<string>;
    log?(...args: unknown[]): void;
    paths: Pick<PlatformPath, 'resolve' | 'relative' | 'dirname' | 'join' | 'isAbsolute'>;
}
export interface MountedModuleOptions {
    /** Host-owned pure compilation reuse; never cache an evaluated module or realm. */
    compile?(entry: string, root: string, build: () => Promise<ModBundle>): Promise<ModBundle>;
    beforeEvaluate?(): Promise<void>;
}
/** Read only the host's mount; each evaluation creates a fresh isolated realm. */
export declare function mountedModuleImporter(fs: ModFileSystem, options?: MountedModuleOptions): ModuleImporter;
//# sourceMappingURL=mounted-import.d.ts.map