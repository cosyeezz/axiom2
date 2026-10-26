/**
 * 宿主 fs 组装件（/server 出口自带，E28）：just-bash Fs 家族的**同名同形类**
 * ——`new MountableFs({...})` 与 just-bash 原 API 一致（用户裁决"保持一致"；
 * 宿主零 just-bash 直引，与 tool()/createSdkMcpServer 同判例）。
 *
 * 懒加载形：构造器同步存参，首个 fs 方法调用时动态 import just-bash
 * （懒 chunk——不用这批件的宿主零装载；fs 方法本就全 async，时序无感）。
 *
 * 语义与原件**逐字一致**（用户裁决，含 `MountableFs` base 缺省=空 InMemoryFs）。
 * 由此的分层行为要点：表外路径**读** ENOENT——union 链正常穿透下一层；表外
 * **写**落入该内存 base（会话内可读回、随实例蒸发）——需要写也穿透到下层的，
 * 显式传一个对写抛 ENOENT 的 `base`。
 */
import type { FileSystem, InitialFiles } from '../data-fs';
/** just-bash `MountConfig` 同形。 */
export interface MountConfig {
    /** Virtual path where the filesystem is mounted (e.g. '/codebuddy/skills'). */
    mountPoint: string;
    filesystem: FileSystem;
}
/** just-bash `MountableFsOptions` 同形（base 缺省=其原生空 InMemoryFs）。 */
export interface MountableFsOptions {
    mounts: MountConfig[];
    base?: FileSystem;
}
/** just-bash `OverlayFsOptions` 常用子集同形。 */
export interface OverlayFsOptions {
    root: string;
    mountPoint?: string;
    readOnly?: boolean;
}
/** just-bash `ReadWriteFsOptions` 常用子集同形。 */
export interface ReadWriteFsOptions {
    root: string;
}
type JustBash = typeof import('just-bash');
/** 懒委托基类：构造器存工厂，首个方法调用装 just-bash chunk 并 memoize 实例。 */
declare abstract class LazyJustBashFs implements FileSystem {
    private impl?;
    protected abstract create(jb: JustBash): FileSystem;
    private resolve;
    readFile(path: string): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): ReturnType<FileSystem['stat']>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    readdir(path: string): Promise<string[]>;
    readdirWithFileTypes(path: string): ReturnType<NonNullable<FileSystem['readdirWithFileTypes']>>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    mv(src: string, dest: string): Promise<void>;
}
/** 挂载表 fs（just-bash `MountableFs` 同名同形同缺省）。 */
export declare class MountableFs extends LazyJustBashFs {
    private readonly options;
    constructor(options: MountableFsOptions);
    protected create(jb: JustBash): FileSystem;
}
/** 纯内存 fs（just-bash `InMemoryFs` 同名同形——构造器同样收 InitialFiles 播种）。 */
export declare class InMemoryFs extends LazyJustBashFs {
    private readonly files?;
    constructor(files?: InitialFiles | undefined);
    protected create(jb: JustBash): FileSystem;
}
/** 真实目录只读视图（just-bash `OverlayFs` 同名：读真盘、写进私有 COW 内存蒸发）。 */
export declare class OverlayFs extends LazyJustBashFs {
    private readonly options;
    constructor(options: OverlayFsOptions);
    protected create(jb: JustBash): FileSystem;
}
/** 真实目录直通读写（just-bash `ReadWriteFs` 同名；自托管落盘用）。 */
export declare class ReadWriteFs extends LazyJustBashFs {
    private readonly options;
    constructor(options: ReadWriteFsOptions);
    protected create(jb: JustBash): FileSystem;
}
export {};
