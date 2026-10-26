import { type ResolvedElementTable } from '../host/element-tables';
import type { CatchHandler, EngineInterface, EventInput, EventName, EventResult, Hook, HookFailure, Matcher, Origin, Pattern, RegisteredMod, Tier } from '../types';
import { type HookStream } from './hook-stream';
interface Entry {
    readonly pattern: Pattern;
    readonly tier: Tier;
    readonly plugin: string;
    readonly matcher?: Matcher;
    readonly hook: Hook;
    readonly signal: AbortSignal;
    /** 全局注册序（同 tier 内先注册的更外层）。 */
    readonly seq: number;
    catchHandler?: CatchHandler;
}
interface ResolveTableCache {
    readonly table: ResolvedElementTable;
    readonly hooks: readonly Entry[];
    readonly signal: AbortSignal;
}
export interface PreparedHookRegistration {
    /** Host-only preview on this registry; concurrent dispatches retain the live topology. */
    run<T>(operation: () => T): T;
    commit(): void;
    discard(reason?: unknown): void;
}
/**
 * `core` 层行为：所有 hook 都 `next()` 到底后由它给出结果。
 *
 * `origin` 是**发起这次分发的调用方**（`next.origin` 的同一个值）。core 需要它做
 * 两件事，缺了就做不成：按 plugin 隔离持久化（`$.store` 不能让一个 mod 读到另一个
 * 的键），以及审计「谁动了宿主资源」。
 */
export type CoreHandler = (event: EventName, input: EventInput, origin: Origin) => EventResult | Promise<EventResult>;
/** 一次 hook 运行期失败（已被隔离，仅作上报）。 */
export interface HookRuntimeFailure {
    /** 哪个 plugin 的 hook。 */
    readonly plugin: string;
    /** 哪个事件上。 */
    readonly event: EventName;
    readonly kind: HookFailure['kind'];
    readonly message?: string;
}
/** hook 运行期失败的上报出口。 */
export type HookFailureReporter = (failure: HookRuntimeFailure) => void;
/** A visual host delivers timer callbacks through its serialized action queue. */
export type HookTimerScheduler = (event: 'clock.after' | 'clock.every', ms: number, callback: () => Promise<void>, signal: AbortSignal) => {
    cancel(): void;
};
/** 一次 dispatch 的可选项。 */
export interface DispatchOptions {
    /** Observe unrecovered failures for this operation without changing fail-open policy. */
    readonly onFailure?: HookFailureReporter;
    /** Host-owned render targeting keeps policy tiers while selecting one user renderer. */
    readonly renderPlugin?: string;
    /** Target session.start/end without replaying other Mods' named lifecycle hooks.
     * Non-user wildcard policy hooks retain their normal tiers and ordering.
     */
    readonly lifecyclePlugin?: string;
    /** 覆盖本次的 core 结果（不走 `setCoreHandler`）。 */
    /**
     * 覆盖本次的 core 结果（不走 `setCoreHandler`）。
     *
     * 可以是一个**值**，也可以是一个**thunk**。给 thunk 的场合是「core 这一层是
     * 一个动作而不是一个答案」—— 最典型的就是 `tool.call`：core = 真的把工具跑
     * 起来。传值意味着调用方必须先执行再分发，那样一个 `{ deny }` 的 hook 也拦不
     * 住已经发生的副作用；传 thunk 才能做到「链真的走到底才执行」。
     */
    readonly coreResult?: EventResult | ((e: EventInput) => EventResult | Promise<EventResult>);
    /** Host-owned projection (e.g. instruction files → text) at every fold boundary. */
    readonly normalize?: (value: EventInput, previous: EventInput) => EventInput | Promise<EventInput>;
    /** Host cancellation; also inherited by nested dispatches. */
    readonly signal?: AbortSignal;
    /** 覆盖单层 hook 预算（ms）。测试可调小。 */
    readonly budgetMs?: number;
    /**
     * 谁发起了这次分发 —— 即 `next.origin`。
     *
     * 官方语义：「Who raised a dispatch … the **calling** plugin's name and the
     * tier it sits in; the engine reads `engine` in `core`.」
     * 所以它是 **caller** 的身份，整条链每一层看到的都是同一个，不是各层自己。
     *
     * 缺省 `{ plugin: 'engine', tier: 'core' }`（引擎自身的调用点）。
     */
    readonly origin?: Origin;
    /**
     * 只让这个 plugin 的 hook 进链。
     *
     * 官方 `ui.message`：一个 `Client` 实例 post 的数据**只有画它的 plugin 的
     * hooks 看得到** —— 别的 mod 既不该读到它，也不该替它回 `{ props }`。
     */
    readonly plugin?: string;
    /**
     * 不让这个 plugin 的 hook 进链。
     *
     * 官方 `ui.resolve`："own table: hook skipped" —— 一个 plugin 用 `ui.resolve`
     * 给**别的** plugin 改元素，它自己拿到的表不经过自己的 hook。
     */
    readonly excludePlugin?: string;
}
/** 引擎自身发起调用时的 origin。 */
export declare const ENGINE_ORIGIN: Origin;
/**
 * Host-internal only: runs `fn` outside the caller's hook frames. Other ALS
 * (Session, tracing, etc.) is untouched. A timer/subscription's callback is
 * a new asynchronous operation, not a continuation of the hook that armed it,
 * so `$` calls inside must not inherit that hook's expired frame. Callers must
 * not expose this on the plugin `$` surface.
 */
export declare function runOutsideHookFrames<T>(fn: () => T): T;
/** Host-only callback boundary; capture its owner's signal before scheduling it. */
export declare function withHostHookOperation<T>(operation: (signal: AbortSignal) => T | Promise<T>, signal?: AbortSignal): Promise<T>;
/** Time in a downstream handler or $ capability is not the caller's work. */
export declare function withHookWait<T>(operation: () => Promise<T>): Promise<T>;
/** $.clock.sleep is deliberately charged, even beside an unawaited next(). */
export declare function withHookSleep<T>(operation: () => Promise<T>): Promise<T>;
/**
 * Host-internal only: never exposed on the plugin's $ surface.
 *
 * Pauses the hook budgets of every ancestor frame while the host does work the hook is not
 * charged for (a human answering, a subprocess, a model call). A failure here is an ordinary
 * rejection of that one `$` call, as the official API documents it: the hook may catch it,
 * or fail with its own throw and reach its registration `.catch`. It never marks the frame.
 */
export declare function withTrustedHostWait<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T>;
/**
 * cbc-mods 的 middleware 引擎 —— 语义等价 Anthropic claude-code 的 function hooks。
 *
 * ## 分发模型
 *
 * 一次 `dispatch(event, input)`：
 * 1. 挑出 pattern 命中 `event`、matcher 命中 `input` 的注册；
 * 2. 按 tier 外→内（`prepend > user > append > builtin > core`）+ 注册序成链；
 * 3. 逐层 `hook($, e, next)`：
 *    - `await next(e)` 透传（改 `e` 即改下游入参）
 *    - 直接返回结果 → 短路，下游不执行，`next.signal` abort
 *    - `{ deny }` → 拒绝语义
 *    - `undefined` → 未干预，冒泡下游/core 结果
 *    - `next.to(e, tier)` → 跳到目标 tier
 * 4. 链走完落 `core`（host 注入的 `CoreHandler`）。
 *
 * ## 运行时约束（对齐官方 `HookBudget`）
 *
 * - 单层 hook 预算 `10s`，`catch` handler `1s`；超时按 `HookFailure{kind:'timeout'}` 处理。
 * - hook 抛错/超时：有 `.catch(handler)` 走它；否则该层按「未干预」继续下游，**不炸整条链**。
 * - `next.trace` 累积每层 `TraceEntry`（plugin/tier/outcome/ms/received/returned）。
 */
export declare class HooksRegistry {
    private readonly lifetime?;
    readonly timerScheduler?: HookTimerScheduler | undefined;
    constructor(lifetime?: AbortSignal | undefined, timerScheduler?: HookTimerScheduler | undefined);
    private readonly entries;
    private readonly modsByTier;
    private seqCounter;
    private coreHandler;
    /** 每个 plugin 自己的 `$`（官方：`engine.create` 一 plugin 一份）。 */
    private readonly enginesByPlugin;
    /** `ui.resolve` 在加载时的答案，`plugin\0surface\0component` → 表。 */
    private readonly resolveTables;
    private readonly pluginLifetimes;
    private readonly preparation;
    private engine;
    private reportFailure;
    /**
     * §6.4 — currently-active hook entries on **this** async stack.
     *
     * A hook is never re-entered while its own frame is being dispatched:
     * an `on('*', …)` that calls `$.ui.log(...)` inside itself would
     * otherwise loop, because `ui.log` is itself an event that matches
     * `*` again. `AsyncLocalStorage` scopes this per-dispatch-chain, so
     * two genuinely concurrent dispatches (two mods each `await
     * next(e)`) do not shadow each other's active set.
     */
    private readonly activeEntries;
    /**
     * Host-only boundary for a new operation delivered by a long-lived worker
     * or subscription. Reset this registry's re-entry guard and hook frames;
     * keep Session/tracing ALS intact. Never expose this on the plugin `$` API.
     * Retained plugin next() closures still carry their original closed frame.
     */
    runOutsideHooks<T>(operation: () => T): T;
    /**
     * 订阅 hook 运行期失败（抛错 / 超时且没有 `.catch` 兜住）。
     *
     * 失败**已经**被隔离成「该层未干预」，链路照常往下走。上报是为了让这类故障
     * **可见**：一个抛错的 hook 对外表现是「mod 完全不生效，但日志干净、加载成功」，
     * 不上报就只能靠盲试定位。
     *
     * @param reporter 上报出口；不设则失败仍被隔离，只是无人知晓
     */
    onHookFailure(reporter: HookFailureReporter | undefined): void;
    /** 设置 `core` 层行为（host 的真实实现）。 */
    setCoreHandler(handler: CoreHandler): void;
    /** 注入 fold 后的默认 `$`（没有 per-plugin 版本时用它）。 */
    setEngine(engine: EngineInterface): void;
    /** 注入某个 plugin 专属的 `$`。 */
    setEngineFor(plugin: string, engine: EngineInterface): void;
    /** Exact plugin surface; hosts must not fall back to another plugin's authority. */
    getEngineFor(plugin: string): EngineInterface | undefined;
    /** Host-only proposed topology; no live hooks, engines or lifetime maps are mutated. */
    withoutRegistrations<T>(names: ReadonlySet<string>, operation: () => T): T;
    private currentPreparation;
    private runPreparation;
    /** Capture once when building a plugin API or scheduling a host callback. */
    signalForPlugin(plugin: string): AbortSignal;
    /** Captured surfaces can act only after their exact registration is published. */
    assertPluginOperation(plugin: string, signal: AbortSignal): void;
    private lifetimeOf;
    private engineOf;
    /**
     * 挂一个 mod：立刻执行 `mod.register(on, options)` 收集注册。
     *
     * 同一 mod 内 `on()` 调用顺序 = middleware 嵌套顺序（先注册的更外层）。
     *
     * **事务语义**：`mod.register()` 是别人的代码，可能在中途抛错。若不回滚，
     * 抛错前注册的那几个 hook 会半截留在链上 —— 一个只生效一半的 mod 比完全
     * 没加载更危险（它的不变量没建立起来）。所以这里记录注册前的水位，出错就
     * 截断回滚，并把异常原样抛给调用方去决定怎么报。
     */
    register(mod: RegisteredMod, signal?: AbortSignal): void | Promise<void>;
    /** Collect replacement hooks without changing the live version, its signals or its engine. */
    prepareRegistration(mod: RegisteredMod, signal?: AbortSignal): PreparedHookRegistration | Promise<PreparedHookRegistration>;
    private collectRegistration;
    /** Revoke this registration and its captured APIs, leaving other identities intact. */
    unregister(plugin: string): void;
    /** 已挂载 mod 名单（按 tier 分组）。 */
    listMods(): ReadonlyMap<Tier, readonly RegisteredMod[]>;
    private dispatchEntries;
    /** 已注册 hook 数（诊断用）。 */
    registrationCount(): number;
    /**
     * 加载时跑一遍 `ui.resolve`，按「plugin × 面 × 组件」缓存答案 ——
     * `$.ui.resolve(e)` 是**读**不是分发（官方："A read, not a dispatch: the
     * engine ran ui.resolve (the other hooks, then core) at load"）。
     *
     * 没有任何 plugin 挂 `ui.resolve` 时什么都不跑，读的时候直接给 core 表。
     * 只有别的 plugin 挂了才需要为某个 plugin 跑：自己的 hook 不改自己的表。
     *
     * @param plugins 拿 `$` 的 plugin（含宿主自己）
     * @param surfaces 宿主会画的面
     * @param components 所有 RenderComponent
     */
    prepareResolveTables(plugins: readonly string[], surfaces: readonly string[], components: readonly string[], publish?: boolean): Promise<ReadonlyMap<string, ResolveTableCache>>;
    /** Publish only after the corresponding prepared registrations have committed. */
    setResolveTables(tables: ReadonlyMap<string, ResolveTableCache>): void;
    /**
     * `$.ui.resolve(e)` 的读：加载时算好的表；没算过（没人挂 `ui.resolve`、
     * 宿主不画的面、不带 component 的老调用）就是该面的 core 表。
     */
    resolveTable(plugin: string, surface: unknown, component: unknown): ResolvedElementTable;
    /** 是否有 hook 会听到 `event`：宿主据此跳过按键级等高频事件的派发。 */
    hears(event: string): boolean;
    /** 某个 mod 声明过的事件名（`plugin.register.uses.events` 用）。 */
    eventsOf(plugin: string): readonly string[];
    /**
     * 针对某个事件 + 某个 discriminant 字段（如 `ui.render` 的 `component`），
     * 汇总"哪些字段值有 hook 可能触发"—— 给宿主做 **cap 广播**用。
     *
     * ## 为什么需要
     *
     * 每个 Web UI slot 组件 mount 都发一次 `_codebuddy.ai/modRenderRequest`
     * 到 agent、agent dispatch 后再 push 回来，光是 15 slot × N instance 的网络
     * 开销就够呛。若能提前知道"根本没 mod 挂 `on('ui.render', { component: 'X' })`"，
     * slot 组件可以**根本不发 request**，直接走默认 React JSX，零网络。
     *
     * ## 三种返回形态
     *
     * - **`'all'`**：至少有一条 `on('ui.render', hook)` **不带 matcher**（或 matcher
     *   里没有该 discriminant 字段）—— 语义是通配匹配所有值，cap 必须包所有
     *   component；宿主策略是 "只要有通配就都发"，Web UI 无法安全跳过。
     * - **`ReadonlySet<string>`**：所有注册都精确 matcher 该字段，收集所有值。
     * - **空 Set**：一条对该事件感兴趣的 hook 都没 —— slot 完全不发 request。
     *
     * ## 只看该事件的 pattern，不算跨事件的通配
     *
     * `on('*', hook)` 会在 `ui.render` 上触发（`patternMatches` 就是这么做的），
     * 因此也必须视作 wildcard cap，把它返回成 `'all'`。
     *
     * @param event 目标事件名（例如 `'ui.render'`）
     * @param discriminant 目标字段（例如 `'component'`）
     */
    matcherValuesFor(event: EventName, discriminant: string): 'all' | ReadonlySet<string>;
    /**
     * 分发一次事件。
     *
     * @param event 具名事件（`tool.call` / `classic.PreToolUse` / `fs.read` …）
     * @param input 事件入参
     * @param options core 结果覆盖 / 预算覆盖
     */
    dispatch(event: EventName, input: EventInput, options?: DispatchOptions): Promise<EventResult>;
    /**
     * 分发一次**流式**事件（官方 `StreamingEventName`：`turn.step` / `process.spawn`）。
     *
     * 链与 `dispatch` 同一套挑选与排序；每层 hook 是 async generator，`next(e)` 是下面
     * 那条流（`HookStream`），见 `hook-stream.ts`。底层是 `coreStream`，没给时取 core
     * handler 对该事件的答案 `{ value: AsyncGenerator }`。
     */
    dispatchStream(event: EventName, input: EventInput, options?: DispatchOptions & {
        readonly coreStream?: (e: EventInput) => AsyncGenerator<unknown, EventResult>;
    }): HookStream<unknown, EventResult>;
    private dispatchInScope;
    private renderElements;
    private runFrom;
}
export {};
//# sourceMappingURL=hooks-registry.d.ts.map