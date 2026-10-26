import type { RenderComponent } from './render-component';
import type { SerializedElement } from './render-registry';
export declare const SURFACE_ELEMENTS: Readonly<Record<string, readonly string[]>>;
/** 所有面的元素名并集（官方 `ElementName`）。表交出去之前补齐到这一整套。 */
export declare const ALL_ELEMENT_NAMES: readonly string[];
/** cbc 宿主实际会画的面：`ui.resolve` 在加载时按这些面各跑一遍。 */
export declare const HOST_SURFACES: readonly string[];
/** 所有 `RenderComponent`：`ui.resolve` 在加载时按组件各跑一遍（matcher 按组件收窄）。 */
export declare const RENDER_COMPONENTS: readonly RenderComponent[];
export type ElementFactory = (props?: Record<string, unknown>) => SerializedElement;
export type ResolvedElementTable = Readonly<Record<string, ElementFactory>>;
/**
 * `$.ui.resolve(e)` 交出的元素记着是哪个 plugin 造的。不可枚举，不会过进程边界；
 * 终端 slot 靠它把按下的 Button 投给画它的 plugin，不用从 hook 链里猜。
 */
export declare const MOD_ELEMENT_ORIGIN: unique symbol;
/**
 * 一个元素构造器：props 进、纯数据元素出（`children` 单独拆出来，与 jsx-shim 一致）。
 * 文字类元素的 children 全是文字时折进 `text`（`<Text>{count}</Text>`），否则字符串
 * 被当成非元素丢掉、面上一片空白。
 */
export declare function elementFactory(tag: string): ElementFactory;
/**
 * core 给某个面的表：该面有的元素是真构造器，其余补成片段。未知面给并集（兼容
 * 不带 surface 的老调用）。冻结、按面缓存。
 */
export declare function baseElementTable(surface: unknown): ResolvedElementTable;
/**
 * 把 `ui.resolve` 链的答案补齐成一张可交出去的表：
 *
 * - 该面的元素：hook 给了函数就用（restyle），给的不是函数或删掉了 → 片段；
 * - 不属于该面的元素：一律片段 —— hook 不能给 terminal 凭空加一个 `Svg`；
 * - 整个答案不是对象（hook 抛错 / 回了别的）→ core 表。
 */
export declare function completeElementTable(answer: unknown, surface: unknown): ResolvedElementTable;
/**
 * 交给 `plugin` 的那张表：构造器照旧，造出的元素记上 `plugin`。按 (表, plugin) 缓存，
 * 同一 plugin 反复 `$.ui.resolve(e)` 拿到同一张表。
 */
export declare function withElementOrigin(table: ResolvedElementTable, plugin: string): ResolvedElementTable;
/** 造出 `tree` 的 plugin（来自 `$.ui.resolve` 的表时才有）。 */
export declare function elementOriginOf(tree: unknown): string | undefined;
//# sourceMappingURL=element-tables.d.ts.map