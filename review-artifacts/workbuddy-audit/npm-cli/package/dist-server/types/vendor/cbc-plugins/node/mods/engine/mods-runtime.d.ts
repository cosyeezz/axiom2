import type { EngineInterface, EventInput, EventName, EventResult, RegisteredMod, Tier } from '../types';
import { type CoreHandler, type DispatchOptions, type HookFailureReporter, HooksRegistry, type HookTimerScheduler } from './hooks-registry';
/** 一个 mod 在启动阶段的失败记录。 */
export interface ModStartupFailure {
    /** 出问题的 mod 名（host 自身的 fold 失败时是 host 名）。 */
    readonly mod: string;
    /** 哪个阶段：准入/注册，还是 `engine.create` fold。 */
    readonly phase: 'register' | 'engine.create' | 'session.start';
    readonly reason: string;
}
/** `ModsRuntime` 的构造项。 */
export interface RuntimeOptions {
    /** Generation lifetime: retained plugin APIs cannot act after a reload or close. */
    readonly signal?: AbortSignal;
    readonly timerScheduler?: HookTimerScheduler;
    /** `core` 层行为（host 的真实实现）。 */
    readonly core?: CoreHandler;
    /** 这份 `$` 归属的 plugin 身份（默认 host 自己）。 */
    readonly plugin?: {
        readonly name: string;
        readonly root: string;
    };
    /**
     * hook 运行期失败（抛错 / 超时）的上报出口。
     *
     * 失败本身已被隔离，链路照常。订阅它是为了让「mod 加载成功却完全不生效」
     * 这类最难查的故障有声音。
     */
    readonly onHookFailure?: HookFailureReporter;
    /** 宿主会画的面：`ui.resolve` 在加载时按这些面各跑一遍。缺省 terminal + cbc-webui。 */
    readonly surfaces?: readonly string[];
}
export interface ModReconcileOptions {
    readonly beforeRemove?: (mod: RegisteredMod) => Promise<void>;
    readonly afterAdd?: (mod: RegisteredMod) => Promise<void>;
    /** Reinstate the prior version's host-owned configuration before restarting it. */
    readonly afterRestore?: (mod: RegisteredMod) => Promise<void>;
}
/**
 * cbc-mods 运行时门面 —— 把「注册 mod → 跑 engine.create fold → 分发事件」串成一条线。
 *
 * ```ts
 * const rt = new ModsRuntime({ core: (event, input) => hostHandle(event, input) });
 * rt.add(telemetryMod);                 // builtin tier
 * rt.add(await loadModFromDirectory(dir, { tier: 'user' }));
 * const $ = await rt.start();           // engine.create fold，$ 冻结
 * await rt.dispatch('tool.call', { tool: 'Bash', command: 'ls' });
 * ```
 */
export declare class ModsRuntime {
    private readonly registry;
    private readonly mods;
    private readonly plugin;
    private engine;
    private started;
    private readonly failures;
    private readonly surfaces;
    private reconcileTail;
    private readonly lifetimes;
    private readonly revisions;
    private readonly signal?;
    constructor(options?: RuntimeOptions);
    /**
     * 供 legacy 扇出使用的 registry。
     *
     * `dispatchLegacyEvent` 需要直接拿到 registry 才能广播 `classic.<Event>`。
     * 只开这一个窄口子，而不是把 registry 整个暴露出去 —— 其余调用方应当走
     * `dispatch()`。
     */
    registryForLegacyFanOut(): HooksRegistry;
    /**
     * 某个 mod 实际注册到的事件列表。
     *
     * 诊断用：「mod 加载成功却不生效」时，第一个要回答的问题是「它到底有没有把
     * hook 挂上去」—— 光看加载日志答不了。
     *
     * @param plugin mod 名
     */
    eventsOf(plugin: string): readonly string[];
    /** 是否有 hook 会听到 `event`。 */
    hears(event: string): boolean;
    /** 设置/替换 `core` 层行为。 */
    setCore(core: CoreHandler): void;
    /**
     * 挂一个 mod。必须在 `start()` 之前调用。
     *
     * 先经 `plugin.register` 事件征询已挂载的 mod（对齐官方：上层可 `{ refuse }`
     * 拒绝一个 mod 入场）—— 该判定在 `start()` 里统一执行，这里只收集。
     */
    add(mod: RegisteredMod): void;
    /**
     * 启动：按 tier 顺序逐个走 `plugin.register` 准入 → 注册 hook → 为每个 mod
     * 跑一次 `engine.create` fold（官方：一 plugin 一份 `$`）→ 冻结。
     *
     * @returns host 自己那份 `$`；host 的 fold 也失败时 `undefined`
     */
    start(): Promise<EngineInterface | undefined>;
    /** Actual admitted identity and generation, never a successfully imported manifest. */
    liveMod(name: string): {
        readonly mod: RegisteredMod;
        readonly generation: number;
    } | undefined;
    /** Host-owned effects (timers/tools/subscriptions) must share this Mod's lifetime. */
    signalForMod(name: string): AbortSignal | undefined;
    private register;
    /** Replace only explicitly selected identities; retained engines of other Mods stay intact. */
    reconcile(mods: readonly RegisteredMod[], names: readonly string[], options?: ModReconcileOptions): Promise<void>;
    /**
     * 记一条 noun 违规。
     *
     * fold 对每个 plugin 各跑一次，同一条违规会被看到 N 次；按 noun 去重，
     * 让宿主的日志里只出现一条而不是刷屏。
     */
    private noteViolation;
    /** 启动过程中各 mod 的失败记录（供宿主报给用户）。 */
    get startupFailures(): readonly ModStartupFailure[];
    /**
     * fold 后的 `$`。
     *
     * host 那一份 fold 失败时为 `undefined` —— 调用方应当判空而不是假定它一定在。
     */
    get $(): EngineInterface | undefined;
    /** 分发一次事件。 */
    dispatch(event: EventName, input: EventInput, options?: DispatchOptions): Promise<EventResult>;
    /** 底层引擎（诊断 / 高级用法）。 */
    get hooks(): HooksRegistry;
    /** 已挂载的 mod 名单（按 tier 分组）。 */
    listMods(): ReadonlyMap<Tier, readonly RegisteredMod[]>;
}
//# sourceMappingURL=mods-runtime.d.ts.map