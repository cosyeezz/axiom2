import { type PlatformPath } from 'node:path';
import { type CoreHandler } from '../engine/hooks-registry';
import type { EventResult, FsAncestor } from '../types';
import type { HostBindings } from './host-bindings';
import { PluginStore } from './plugin-store';
import { RenderRegistry, type SerializedElement } from './render-registry';
import { ModStateStore } from './state-store';
/**
 * `core` 层：`$` 上每个能力调用最终落到这里。
 *
 * ## 这一层的位置
 *
 * `$.fs.read(p)` 不是一次直接的文件读取，而是一次 `fs.read` 事件分发 —— 先经过每一
 * 层 hook（别的 mod 可以拦、可以改路径、可以 `{ deny }`），没人应答才落到 core。
 * 官方 `sec-default` 正是靠这个机制给宿主资源加策略。因此 core 只管「真的去做」，
 * 不重复做准入判断。
 *
 * ## 未注入的能力返回 `{ deny }`，不返回 undefined
 *
 * 宿主可能只接了一部分绑定。这时必须给 mod 一个**明确的拒绝** —— `engine-builder`
 * 会把 `deny` 变成一个带能力名的异常，mod 能 catch 并退化（官方 mod 就是这么写的）。
 * 若回 `{ value: undefined }`，mod 会把「没实现」当成「值就是空」继续往下跑，错误
 * 被推迟到很远的地方才炸。
 */
export interface CoreHandlerOptions {
    readonly bindings?: HostBindings;
    /** Host-owned stores may outlive a Mod generation, but not their Session runtime. */
    readonly sessionStores?: Map<AbortSignal, PluginStore>;
    /** Host lifetime: reject new core calls after disposal, including retained `$` methods. */
    readonly signal?: AbortSignal;
    /** Captured at each call; long-lived resources are revoked by their owning Mod, not another Mod's refresh. */
    readonly pluginSignal?: (plugin: string) => AbortSignal | undefined;
    /**
     * 共用的渲染树登记表。
     *
     * 必须由调用方持有：`ui.render` 的树是**链的返回值**（hook 画好后直接返回，
     * 通常不会 `next(e)` 到 core），所以序列化只能发生在 dispatch 之后、由宿主
     * 完成；而 `ui.press` 的回流又要在 core 里查同一张表。两边共用一个实例才对
     * 得上。不传则 core 自己建一个（只有回流、没有登记，press 永远查不到）。
     */
    readonly renders?: RenderRegistry;
    /**
     * `$.state` 的值。由宿主持有才能跨 mod 热重载存活；不传则 core 自建一份，
     * 写入后经 `bindings.invalidate('ui.render')` 重画。
     */
    readonly state?: ModStateStore;
}
/**
 * 从 `of`（缺省会话 cwd）逐级向上，收集名字命中的文件。
 *
 * 这是 `agents-md` 找祖先 `AGENTS.md` / `CLAUDE.md` 的唯一手段，语义要点（全部以
 * 官方 `$.fs.ancestors` 的 jsdoc 为准）：
 *
 * - **root first** —— 最远的祖先排在前。这一条极易想反：直觉上「最近的最重要所以
 *   放前面」，但官方明确 `@returns the files found, root first`，而 mod 依赖这个
 *   顺序决定谁覆盖谁。顺序反了不会报错，只会让优先级悄悄颠倒。
 * - `below` 给出**下界**（到这个目录为止，含它），把遍历关在项目内 —— 否则一路走到
 *   `/`，用户家目录里无关的同名文件也会被吸进来。
 * - `names` 是相对 `.md` 文件名，允许子路径（官方就用 `.claude/AGENTS.md`），
 *   但**不允许 `..`** —— 那等于绕开 `below` 的约束。
 * - 读不出来的文件**跳过**而不是中断整次遍历：权限不足的一个目录不该让能力失效。
 */
export interface AncestorFileSystem {
    readText(path: string): Promise<string>;
    isFile(path: string): Promise<boolean>;
    paths: Pick<PlatformPath, 'resolve' | 'parse' | 'dirname' | 'join'>;
}
export declare function ancestorsOf(names: readonly string[], from: string, below?: string, fs?: AncestorFileSystem): Promise<FsAncestor[]>;
/**
 * 把一次 `ui.render` 的**链返回值**序列化并送到各个面。
 *
 * 为什么是这里而不是 core：`ui.render` 的语义是「hook 画好树并返回」，官方
 * `NextResult<'ui.render'>` 就是 `RenderElement`。画界面的 hook 通常不会再
 * `next(e)`，所以树根本不会到达 core —— 把序列化写在 core 里，结果就是
 * 「mod 明明画了，宿主什么也没收到」。
 *
 * @param renders 与 core 共用的登记表（`ui.press` 要在里面查闭包）
 * @param bindings 宿主绑定，提供 `paint` 出口
 * @param plugin 画这棵树的 mod
 * @param result 一次 `ui.render` dispatch 的结果
 * @returns 序列化后的树；链上没人画则 undefined
 */
export declare function paintRenderResult(renders: RenderRegistry, bindings: HostBindings, plugin: string, result: EventResult): Promise<SerializedElement | undefined>;
export declare function createCoreHandler(options?: CoreHandlerOptions): CoreHandler;
//# sourceMappingURL=core-handler.d.ts.map