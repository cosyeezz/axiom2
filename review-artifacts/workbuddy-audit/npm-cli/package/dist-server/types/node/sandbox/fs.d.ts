import { type Sandbox } from './sandbox';
export interface ToolFileStats {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    mtime: Date;
}
export interface ToolDirent {
    name: string;
    isDirectory(): boolean;
}
/** The sandbox for this call, if one is mounted. Exported for one-off branches. */
export declare function resolveFileSandbox(): Sandbox | undefined;
export declare const readTextFile: (path: string) => Promise<string>;
export declare const readBinaryFile: (path: string) => Promise<Buffer>;
export declare const writeFileData: (path: string, data: string | Uint8Array) => Promise<void>;
export declare const appendFileData: (path: string, data: string | Uint8Array) => Promise<void>;
/** node access() semantics: resolves when present, rejects with ENOENT otherwise. */
export declare const accessPath: (path: string) => Promise<void>;
export declare const statPath: (path: string) => Promise<ToolFileStats>;
export declare const ensureDir: (path: string) => Promise<void>;
export declare const readDirWithTypes: (path: string) => Promise<ToolDirent[]>;
/**
 * Per-path 临界区：同一 fs 落点上对同一路径的 read→modify→write 组合以
 * promise 链互斥（edit-tool.spec R6 锚点：并行同文件编辑不丢改动——全 async
 * IO 下"后写覆盖先写"的竞态不能靠微任务拍数挡）。
 *
 * 串行域=fs 实例本身（宿主单例一张表、每沙箱实例一张表，WeakMap 随沙箱
 * 回收）：不同沙箱里的同名路径互不排队，域判定与读写落点同源，调用方无需
 * 感知沙箱。域在排队前同步捕获；task 入队后执行时 ALS 上下文随 promise 链
 * 保留，task 内的 fs 调用落点与域一致。链尾自清防 Map 泄漏。
 */
export declare function withPathLock<T>(path: string, task: () => Promise<T>): Promise<T>;
