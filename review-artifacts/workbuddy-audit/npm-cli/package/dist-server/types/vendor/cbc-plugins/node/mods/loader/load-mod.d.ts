import { type PlatformPath } from 'node:path';
import type { PluginOptions, Register, RegisteredMod, Tier } from '../types';
import { type ManifestDir } from './manifest-dir';
export { JSX_SHIM_SOURCE } from './jsx-shim';
/** `plugin.json` 的形状（对齐官方 mod 的 manifest）。 */
export interface PluginManifest {
    name: string;
    version?: string;
    description?: string;
    author?: {
        name?: string;
    } | string;
    /**
     * 该 plugin 的类型契约路径，相对 plugin root、以 `./` 开头。
     *
     * 官方约束（`plugin validate` 会查）：一个**自包含**的 `.d.ts` —— 不含
     * import / export-from / require / reference，顶层导出它在 `engine.create`
     * 里加的 noun 的类型，并在 `declare module 'codebuddy-code' { interface
     * EngineInterface { … } }`（或 `'claude-code'`）里声明该 noun，别无其他。
     */
    types?: string;
    /** 该 mod 的默认配置项。 */
    options?: PluginOptions;
}
/** `hooks/hooks.json` 的形状。 */
export interface HooksManifest {
    description?: string;
    /** register 模块路径列表（相对 hooks.json 所在目录）。 */
    modules: readonly string[];
}
/** 一个已解析、可挂载的 mod 包。 */
export interface LoadedMod extends RegisteredMod {
    readonly manifest: PluginManifest;
    /** manifest 实际来自哪个受支持的插件元数据目录。 */
    readonly manifestDir: ManifestDir;
    readonly hooks: HooksManifest;
}
/** 模块加载器：把一个 TS/JS 入口变成运行时模块。 */
export type ModuleImporter = (absPath: string, root?: string) => Promise<unknown>;
/** 载入 mod 时的可选项。 */
export interface LoadOptions {
    /** Metadata and code must use the same mounted filesystem. */
    readonly readText?: (path: string) => Promise<string>;
    readonly paths?: Pick<PlatformPath, 'join' | 'resolve' | 'isAbsolute'> & Partial<Pick<PlatformPath, 'relative'>>;
    /** 挂载 tier，默认 `user`。 */
    readonly tier?: Tier;
    /** 覆盖/补充 manifest 里的 options。 */
    readonly options?: PluginOptions;
    /**
     * 自定义模块加载器。默认加载器处理 TS/TSX、目录 import 和 `.js` → `.ts`
     * 解析；Bun 使用原生转译器，Node 必要时使用内嵌的 jiti 转译器。
     */
    readonly importModule?: ModuleImporter;
    /**
     * 是否走**隔离通道**：把 register 模块塞进 vm 沙箱执行，脚本因此够不到宿主的
     * `require` / `process` / `global` 等高危面（见 `isolated-import.ts`）。
     *
     * 缺省 `false`，保持「宿主 realm 内 `import()`、mod 可直接用 Node 内建」的既有
     * 语义。`options.importModule` 显式给出时本项被忽略（自定义加载器优先）。
     */
    readonly isolate?: boolean;
}
/** 转译模块图并缓存；宿主通道以 ESM 桥接同一份 CJS 图。 */
export declare function bundleAndImport(entry: string, env?: NodeJS.ProcessEnv): Promise<unknown>;
/**
 * Bun 的 TS/TSX 一律用 Bun.Transpiler；Node 的 JSX 与特殊 TS 语法用 jiti。
 * Node 非 JSX 优先使用内建 type stripping 与 mod 作用域的解析钩子。
 * 其它加载/执行错误原样抛出，避免被误判成转译器缺失。
 */
export declare function defaultImporter(entry: string, root?: string): Promise<unknown>;
/**
 * 从一个 mod 目录载入 mod —— 等价官方 `claude --plugin-dir <path>`。
 *
 * 期望目录结构（与 `anthropics/claude-code/mods/*` 完全一致）：
 * ```
 * <root>/
 * ├── .codebuddy-plugin/plugin.json   # cbc 优先；官方 mod 用 .claude-plugin，同样识别
 * └── hooks/
 *     ├── hooks.json                  # { description, modules: ["./register.ts"] }
 *     └── register.ts                 # export function register(on, options)
 * ```
 *
 * 多个 `modules` 的 `register` 按声明顺序执行（等价一个 mod 内多段注册，
 * 先声明的更外层）。
 *
 * @param root mod 目录（含 `.codebuddy-plugin/` 或 `.claude-plugin/`）
 * @param options tier / options / 自定义 importer
 */
export declare function loadModFromDirectory(root: string, options?: LoadOptions): Promise<LoadedMod>;
/** 判断一个目录是否是 mod（带 function hooks 的 plugin）。 */
export declare function isModDirectory(root: string, readText?: (path: string) => Promise<string>, joinPath?: (...paths: string[]) => string): Promise<boolean>;
/** 把一个已在内存里的 `register` 包成 mod（测试 / 宿主自带 mod 用）。 */
export declare function modOf(name: string, tier: Tier, register: Register, options?: PluginOptions, root?: string): RegisteredMod;
/**
 * Official `PluginRegisterUses` of a plugin's hooks sources: the events it
 * hooks (`on('x.y'`) and the `$` calls it makes (`$.noun.method(`), sorted.
 */
export declare function usesOf(sources: readonly string[]): {
    events: string[];
    calls: string[];
};
//# sourceMappingURL=load-mod.d.ts.map