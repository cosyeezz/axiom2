/**
 * Data-fs seam —— **用户数据平面**（~/.codebuddy 域：todos / tasks / blobs /
 * skills…）。名字不再自带 "user-data"，平面边界在此成文：本 seam 只管用户
 * 数据平面，**工作区平面（项目 cwd 下的文件）不经此路由**——业务点要把
 * 工作区路径接进来须显式判界（先例：workflow-registry 的项目级目录判定）。
 * Two faces, one adapter, one resolution slot:
 * - config face = just-bash `IFileSystem` structural subset — host filesystems
 *   (InMemoryFs / MountableFs / OverlayFs) plug in as-is; composition is
 *   mounting, there is no mounts field.
 * - consumption face = node:fs/promises shape — kernel call sites migrate by
 *   source swap and keep their `error.code === 'ENOENT'` branches (the adapter
 *   backfills errno codes).
 * - resolution: session tier ?? process tier ?? local passthrough — bin modes
 *   never register anything, so they stay on fs/promises unchanged. The slot
 *   is not a DI binding: direct-construction unit specs keep working.
 */
import * as nativePath from 'node:path';
import type { Session } from '../../vendor/cbc-core/node/index.js';
/** Optional native revision metadata. Virtual filesystems must not invent it. */
export interface FileSystemRevision {
    dev?: number | bigint;
    ino?: number | bigint;
    mode?: number;
    ctimeMs?: number;
    mtimeMs?: number;
}
export interface FileSystemStat extends FileSystemRevision {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
    size: number;
    mtime: Date;
}
export interface FileSystemDirent {
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink: boolean;
}
/** Structural subset of just-bash `IFileSystem` — its instances plug in as-is. */
export interface FileSystem {
    /** Mounted filesystems default to POSIX paths; host passthroughs opt into native paths. */
    readonly pathStyle?: 'posix' | 'native';
    readFile(path: string): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileSystemStat>;
    /** Optional metadata for filesystems that can identify linked paths. */
    lstat?(path: string): Promise<FileSystemStat>;
    realpath?(path: string): Promise<string>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readdirWithFileTypes?(path: string): Promise<FileSystemDirent[]>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    /** Optional: the adapter falls back to copy + rm for rename when absent. */
    mv?(src: string, dest: string): Promise<void>;
}
/** Mirrors just-bash `InitialFiles`: path → content, init object, or lazy provider. */
export type InitialFiles = Record<string, string | Uint8Array | {
    content: string | Uint8Array;
} | (() => string | Uint8Array | Promise<string | Uint8Array>)>;
export interface DataFsStats extends FileSystemRevision {
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtime: Date;
    mtimeMs: number;
}
export interface DataFsDirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
export interface DataFs {
    readonly pathStyle?: 'posix' | 'native';
    readFile(path: string, encoding: 'utf-8' | 'utf8'): Promise<string>;
    readFile(path: string): Promise<Buffer>;
    writeFile(path: string, data: string | Uint8Array, encoding?: 'utf-8' | 'utf8'): Promise<void>;
    access(path: string): Promise<void>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readdir(path: string, options: {
        withFileTypes: true;
    }): Promise<DataFsDirent[]>;
    stat(path: string): Promise<DataFsStats>;
    lstat?(path: string): Promise<DataFsStats>;
    realpath?(path: string): Promise<string>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    unlink(path: string): Promise<void>;
}
/** Build a node-style errno error (`code` set, node message shape). */
export declare function errnoError(code: string, message: string): NodeJS.ErrnoException;
/** Install (or clear) the process tier. Server arming only; bin never calls. */
export declare function registerDataFs(provider: DataFs | undefined): void;
/** 进程层当前注册的 fs（会话层 overlay 组合用；E26）。bin 恒 undefined。 */
export declare function registeredDataFs(): DataFs | undefined;
/**
 * 盘上 user-data 平面是否已被进程注入取代（sync 探针）。同步旁路读者
 * （pre-DI 的 settings 指示检查等）无法走异步 seam 读挂载档——按「不读已被
 * 换源的平面」处理：注入在场即视作盘档不存在，避免与异步面（读挂载档）
 * 形成同 scope 双真源分裂。bin 从不注册，恒 false。
 */
export declare function hasRegisteredDataFs(): boolean;
/** Bind (or clear) the session tier at activation. Mirrors the sandbox mount seam. */
export declare function setSessionDataFs(session: Session, provider: DataFs | undefined): void;
/**
 * The provider for ~/.codebuddy reads and writes. Never undefined. Tier
 * fallback shadows whole (no per-path merge — compose content host-side by
 * mounting): the root scope's session-bound fs, then the process-registered
 * fs, then the local fs/promises passthrough. Root, not current: the binding
 * is identity-plane data living on the query's main session, and subagent
 * runs (own current session, zero bindings) must keep writing into it.
 */
export declare function resolveDataFs(): DataFs;
/** Use the selected provider's namespace, not the operating system hosting it. */
export declare function dataFsPath(): typeof nativePath;
/**
 * The ~/.codebuddy fs as a plain module-level object — import it and call it
 * like `fs/promises`. Every method runs `resolveDataFs()` at invocation
 * time, so tier binding stays dynamic; never capture the resolver's result
 * into long-lived state instead.
 *
 * Catalog scans (skills, plugins) read through this same face — the single
 * face is deliberate (用户定稿): session-owned data is already path-keyed by
 * sessionId, and what a session sees is decided by what the host mounts.
 * Catalog rebuilds run at start()/boot outside any run context, so they hit
 * the process tier there; a lazy catalog read inside a run follows the run's
 * binding like every other read.
 */
export declare const dataFs: DataFs;
/**
 * Recursive file enumeration over the seam, by extension — the shared walk
 * for catalog scanners (custom agents / commands providers). Symlink entries
 * classify via stat; a depth cap guards degenerate trees. Mirrors
 * DirectoryScanUtils.getFilesByExtension's shape without touching the real
 * filesystem when an fs is injected.
 */
export interface ScannedFile {
    fullPath: string;
    fileName: string;
    relativePath: string;
}
export interface ScanFilesOptions {
    /** An operation-scoped decorator of the selected provider, never a native-fs bypass. */
    filesystem?: DataFs;
    maxEntries?: number;
    onError?: (error: Error, path: string) => void;
    signal?: AbortSignal;
    /** Filesystems with link metadata can supply realpath for cycle and alias detection. */
    canonicalizeDirectory?: (path: string) => Promise<string>;
}
export declare function scanFilesByExtension(baseDir: string, extension: string, maxDepth?: number, options?: ScanFilesOptions): Promise<ScannedFile[]>;
/**
 * Wrap a config-face filesystem into the node:fs/promises-shaped provider:
 * Stats/Dirent booleans become methods, Uint8Array becomes Buffer, errno
 * codes are backfilled.
 */
export declare function createDataFsAdapter(fs: FileSystem): DataFs;
/**
 * Seed `start({ files })` into a config-face filesystem: parents are created,
 * init objects unwrap to their content, lazy providers resolve eagerly.
 */
export declare function seedInitialFiles(fs: FileSystem, files: InitialFiles): Promise<void>;
