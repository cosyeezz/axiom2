import { Logger } from '@celljs/core';
import { ProductConfiguration, ProductProvider, ProductProviderContext, Skill } from '@genie/product';
import { FileSystem } from '@genie/runtime';
import { type DataFs } from '../data-fs';
declare global {
    var __CODEBUDDY_BUILTIN_SKILLS__: Array<{
        name: string;
        filePath: string;
        references?: Array<{
            path: string;
            filePath: string;
        }>;
    }> | undefined;
}
export interface SkillScanError {
    path: string;
    message: string;
}
export interface SkillListDetailedResult {
    skills: Skill[];
    errors: SkillScanError[];
}
/** Explicit catalog discovery; omission preserves CLI environment and cache behavior. */
export interface SkillDiscoveryOptions {
    readonly extraUserRoots?: readonly string[];
    readonly builtinDirectory?: string;
    /** Private discovery IO seam; the caller must preserve the current filesystem namespace. */
    readonly filesystem?: DataFs;
}
/**
 * Skill product provider that reads SKILL.md files from .claude/skills directories
 * and converts them to product skill format.
 */
export declare class SkillProductProvider implements ProductProvider {
    scope: "runtime";
    priority: number;
    /** Filesystem and builtin seed skills must be rebuilt by runtime-only refreshes. */
    volatile: boolean;
    protected readonly fs?: FileSystem;
    protected readonly logger: Logger;
    private readonly discovery;
    private get scanFs();
    dispose(): void;
    private skillsCache?;
    private skillErrorsCache?;
    private skillsLoading?;
    private cacheGeneration;
    private webUiSkillsLoading?;
    clearCache(): void;
    listSkills(cwd: string, forceReload?: boolean): Promise<Skill[]>;
    /**
     * Reads one explicit workspace without changing the process cwd. The
     * explicit cwd affects only the project root; USER and connector roots
     * remain the canonical process-level locations.
     */
    listSkillsDetailed(cwd: string, forceReload?: boolean, options?: SkillDiscoveryOptions): Promise<SkillListDetailedResult>;
    provide(ctx?: ProductProviderContext): Promise<ProductConfiguration>;
    /**
     * 对指定根目录做一次树扫描（会话档技能用）：server 层在会话 rootScope 内
     * 调用，ambient dataFs 因此解析到会话 fs——进程档缓存不参与也不受污染。
     */
    scanTree(baseDir: string, source?: string): Promise<Skill[]>;
    /** Scan the current filesystem scope without reading or replacing the process cache. */
    scanWorkspace(cwd: string): Promise<Skill[]>;
    /** Loaded explicitly by an authenticated Web UI session, never into Product's global skills. */
    loadWebUiSkills(): Promise<Skill[]>;
    private loadSkillsCached;
    private loadSkillsDetailedCached;
    private loadSkillsDetailed;
    private loadSkills;
    private loadBundledSkills;
    private pathExists;
    private cloneSkills;
    private cloneDetailedResult;
    /**
     * Maximum recursion depth for scanning nested skill directories.
     */
    private static readonly MAX_SCAN_DEPTH;
    private scanSkillsDirectory;
    private getSkillLoadConcurrency;
    private isDirectoryEntry;
    private isFileEntry;
    private resolveBundledResourceName;
    private parseSkillFile;
    private addScanError;
}
