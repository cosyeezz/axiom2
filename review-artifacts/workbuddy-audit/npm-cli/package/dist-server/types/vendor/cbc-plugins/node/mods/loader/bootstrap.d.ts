import type { CoreHandler, HookFailureReporter } from '../engine/hooks-registry';
import { type ModReconcileOptions, ModsRuntime, type ModStartupFailure } from '../engine/mods-runtime';
import type { HostBindings } from '../host/host-bindings';
import { MOD_SOURCE_RUNTIME_ENTRIES } from './contained-bundle';
import { type LoadedMod, type LoadOptions } from './load-mod';
/**
 * 从 `--plugin-dir` 发布的环境变量里把 mod 拉起来。
 *
 * `cli-dispatcher` 已经把 `--plugin-dir` 的目录列表写进 `CODEBUDDY_PLUGIN_DIRS`
 * （以 `path.delimiter` 分隔），本模块是它在 mods 侧的消费者：挑出其中**带
 * function hooks 的目录**（有 `hooks/hooks.json` 且列了 `modules`），逐个加载
 * 并组装成一个 `ModsRuntime`。
 *
 * 因此 `codebuddy --plugin-dir mods/diff` 与官方 `claude --plugin-dir mods/diff`
 * 走的是同一条路：读 manifest（`.codebuddy-plugin` 优先、`.claude-plugin` 兼容）
 * → 加载 TS register 模块 → 按 tier 坐好 → `engine.create` fold 出 `$`。
 *
 * 全程受 `CBC_ENABLE_FUNCTION_HOOKS` 约束（默认开）：显式关闭时返回 `undefined`，
 * 宿主照旧走老 shell hooks 路径，零副作用。
 */
/** `--plugin-dir` 发布目录列表的环境变量名（由 cli-dispatcher 写入）。 */
export declare const PLUGIN_DIRS_ENV = "CODEBUDDY_PLUGIN_DIRS";
/** 一次 bootstrap 的入参。 */
export interface BootstrapOptions {
    readonly signal?: AbortSignal;
    /** 读取的环境（默认 `process.env`）。 */
    readonly env?: NodeJS.ProcessEnv;
    /** 显式指定目录，跳过环境变量（测试 / 编程式使用）。 */
    readonly dirs?: readonly string[];
    /**
     * `core` 层行为。不传则用 `createCoreHandler(bindings)` —— 即真实的宿主能力面。
     *
     * 显式传入只有两种场合：测试要固定 core 的答案，或宿主要在默认之上再包一层。
     */
    readonly core?: CoreHandler;
    /**
     * 宿主能力绑定（cwd / root / ui / settings / store 落盘位置）。
     *
     * 不传等于「什么能力都没接」：mod 仍能注册、仍能拿到 `$`，但调 `$.ui.log()` /
     * `$.settings.read()` 会得到明确的拒绝。`core` 显式给出时本项被忽略。
     */
    readonly bindings?: HostBindings;
    /** 载入每个 mod 时的选项（tier / options / importer）。 */
    readonly load?: LoadOptions;
    /** Host-owned source selection. Metadata, import and identity must refer to the same immutable version. */
    readonly source?: (root: string) => Promise<BootstrapSource | undefined>;
    /** 加载失败时的回调；不传则静默跳过该目录。 */
    readonly onError?: (dir: string, error: unknown) => void;
    /**
     * 是否挂载宿主自带的 builtin mod（telemetry / sec-default）。默认挂。
     *
     * 关掉它的唯一正当场景是测试要一个**干净**的引擎 —— 内置 mod 会往 `$` 上
     * 加 noun、会拦 `$.fs.*`，混在断言里会让「是谁干的」变得不清楚。
     */
    readonly withBuiltins?: boolean;
    /**
     * hook 运行期失败（抛错 / 超时）的上报出口。
     *
     * 与 `onError` 不同：那是**加载期**的失败，这是 mod 已经跑起来之后某次
     * dispatch 里的失败。后者已被隔离成「该层未干预」，不上报就完全没有声音。
     */
    readonly onHookFailure?: HookFailureReporter;
}
export interface BootstrapSource {
    readonly fingerprint: string;
    readonly load: LoadOptions;
    /** Revalidate current selection/approval before and after evaluation, never cache this decision. */
    check(): Promise<void>;
}
/** bootstrap 的结果。 */
export interface BootstrapResult {
    /**
     * 已启动的运行时（`$` 已 fold 完毕）。
     *
     * 一个 mod 都没成功加载、或 host 的 fold 也失败时为 `undefined` —— 此时
     * `skipped` 说明每个目录为什么没上车，caller 应当把它报出来而不是当作
     * 「无事发生」。
     */
    readonly runtime?: ModsRuntime;
    /** 成功加载的 mod。 */
    readonly mods: readonly LoadedMod[];
    /** 被跳过的目录（不是 mod，或加载失败）与原因。 */
    readonly skipped: readonly {
        readonly dir: string;
        readonly reason: string;
    }[];
    /** 启动阶段各 mod 的失败（注册抛错、`engine.create` 违规等）。 */
    readonly failures: readonly ModStartupFailure[];
    /** Content identities captured before import and checked again after import. */
    readonly fingerprints?: ReadonlyMap<string, string>;
}
/** Host cache bookkeeping is not executable package content. These names are reserved at the package root. */
export { MOD_SOURCE_RUNTIME_ENTRIES };
/** Hash the package contents, including relative imports, independently of manifest versions and mtimes. */
export declare function modSourceFingerprint(root: string): Promise<string>;
export interface ReconcileBootstrapOptions extends ModReconcileOptions {
    readonly dirs: readonly string[];
    /** 省略时核对全部候选，仅替换实际变化的 Mod。 */
    readonly targetedModNames?: readonly string[];
}
/** Reuse the original importer and host bindings; only selected changed identities are re-evaluated. */
export declare function reconcileModsFromPluginDirs(previous: BootstrapResult, options: ReconcileBootstrapOptions): Promise<BootstrapResult>;
/** 从环境变量解析出目录列表。 */
export declare function pluginDirsOf(env?: NodeJS.ProcessEnv): readonly string[];
/**
 * 加载 `--plugin-dir` 里的 mod 并启动运行时。
 *
 * ## 绝不阻塞调用方
 *
 * 这是宿主启动链上的一站，因此**本函数不向外抛**。任何一层出问题都被降级成
 * 「记录 + 继续」：
 *
 * | 出错的地方 | 结果 |
 * |---|---|
 * | 某个目录不是 mod / 读不出 manifest / TS 加载失败 | 进 `skipped`，其余目录照常 |
 * | 某个 mod 的 `register()` 自己抛错 | 进 `failures`，其余 mod 照常 |
 * | 某个 mod 的 `engine.create` 违规 | 进 `failures`，它拿不到 `$`，其余照常 |
 * | 连 host 的 fold 都失败 | `runtime` 为 `undefined`，宿主退化成「无 mods 能力」 |
 * | 任何未预料的异常 | 兜住并记入 `failures`，返回已有结果 |
 *
 * 返回 `undefined` **只在真的无事可做时**：function hooks 被显式关闭，或没有任何
 * `--plugin-dir`。只要有目录被指定，就一定返回结果对象，调用方因此永远能报告
 * 出「为什么我的 --plugin-dir 没生效」。
 *
 * @param options 环境 / 显式目录 / core 行为 / 载入选项
 */
export declare function bootstrapModsFromPluginDirs(options?: BootstrapOptions): Promise<BootstrapResult | undefined>;
//# sourceMappingURL=bootstrap.d.ts.map