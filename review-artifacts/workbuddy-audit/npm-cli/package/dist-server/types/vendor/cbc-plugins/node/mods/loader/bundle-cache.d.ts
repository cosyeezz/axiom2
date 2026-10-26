/**
 * 转译模块图的磁盘缓存。键包含入口、产物格式及转译器版本；清单保存实际输入
 * 的 mtimeMs 和 size。命中时只 stat，不初始化转译器或重复解析源码。
 */
/**
 * 缓存格式版本。改动 bundle 选项（target / format / jsx 等）或产物语义时**必须**
 * 递增 —— 否则旧产物会被错误复用。
 */
export declare const CACHE_VERSION = 2;
/** 缓存查询结果。 */
export interface CacheLookup {
    /** 产物的绝对路径（ESM flavor 为 `.mjs`，isolated flavor 为 `.cjs`）。 */
    readonly modulePath: string;
    /** manifest 的绝对路径。 */
    readonly manifestPath: string;
    /** 命中则为 true —— 直接 import `modulePath` 即可。 */
    readonly isFresh: boolean;
    readonly verifyContent?: boolean;
}
/** 缓存根目录：尊重 `CODEBUDDY_CONFIG_DIR`，否则 `~/.codebuddy`。 */
export declare function cacheRoot(env?: NodeJS.ProcessEnv): string;
/**
 * 查缓存：产物在不在、还新鲜不新鲜。
 *
 * @param entry register 模块的绝对路径
 * @param transpilerVersion 转译器版本（参与缓存键）
 * @param env 环境（用于定位缓存根）
 * @param flavor 产物风味：`''`（默认）= ESM `.mjs`（走 `import()`）；非空（如
 *   `'cjs-vm'`）= CJS `.cjs`（读回字符串塞进 vm 沙箱执行）。不同 flavor 各占
 *   独立缓存键，互不覆盖。
 */
export declare function lookupCache(entry: string, transpilerVersion: string, env?: NodeJS.ProcessEnv, flavor?: string): Promise<CacheLookup>;
/**
 * 写缓存。产物先写临时文件再 `rename`，避免并发进程读到半截内容。
 *
 * @param lookup `lookupCache` 给出的路径
 * @param entry register 模块绝对路径
 * @param code bundle 产物
 * @param inputPaths 本次 bundle 读过的文件（包含转递依赖）
 */
export declare function writeCache(lookup: CacheLookup, entry: string, code: string, inputPaths: readonly string[], expectedHashes?: Readonly<Record<string, string>>): Promise<void>;
//# sourceMappingURL=bundle-cache.d.ts.map