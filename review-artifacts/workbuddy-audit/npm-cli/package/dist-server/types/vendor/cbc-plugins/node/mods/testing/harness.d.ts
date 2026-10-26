import { HooksRegistry } from '../engine/index';
import type { EngineInterface, EventInput, EventName, EventResult, On, RegisteredMod, Tier } from '../types';
/**
 * 测试脚手架 —— 语义对齐官方 `claude-code/testing`。
 *
 * 核心约定（原文）：「A test gets the engine's own `$` and a plugin's `on`. …
 * The hooks the test registers with `on` sit **beneath** the mod, where the
 * rest of the world would be, and **nothing is beneath them**: a call they
 * leave unanswered throws, naming its event.」
 *
 * 所以：
 * - 被测 mod 挂在 `tier(t)` 声明的层；
 * - 测试用 `on()` 注册的 hook 挂在 `core` 层（世界层，在 mod 之下）；
 * - 没有任何 hook 应答的 `$` 调用 → 抛错并点名事件。
 */
/** 一次 harness 的句柄。 */
export interface Harness {
    /** fold 后的 `$`（等于被测 mod 看到的那一个）。 */
    readonly $: EngineInterface;
    /** 世界层注册器（挂在 `core` tier，位于被测 mod 之下）。 */
    readonly on: On;
    /** 直接分发事件（绕过 `$`，用于测 middleware 行为）。 */
    readonly dispatch: (event: EventName, input: EventInput, coreResult?: EventResult) => Promise<EventResult>;
    /** 底层引擎。 */
    readonly hooks: HooksRegistry;
}
/** `createHarness` 的入参。 */
export interface HarnessOptions {
    /** 被测 mod。 */
    readonly mod: RegisteredMod;
    /** 额外挂载的 mod（如 noun provider）。 */
    readonly also?: readonly RegisteredMod[];
}
/**
 * 建一套测试环境：被测 mod 在它声明的 tier，测试 hook 在 `core` 层。
 *
 * 未被应答的调用会抛错，形如：
 * `nothing answered "fs.read"; register a hook for it in the test`
 */
export declare function createHarness(options: HarnessOptions): Promise<Harness>;
/**
 * 延迟建 harness 的形态：先让测试用 `on()` 注册世界层，再 `ready()` 构建 `$`。
 *
 * 官方 `test(name, async ($, on) => ...)` 里 `$` 与 `on` 同时可用，是因为
 * 世界层 hook 的注册和 `$` 调用发生在同一个同步 body 的不同时刻；这里用
 * 「先收集、首次 `$` 调用时 fold」的等价做法。
 */
export interface LazyHarness {
    readonly on: On;
    /** 首次访问时 fold；之后返回同一个 `$`。 */
    readonly $: EngineInterface;
    readonly dispatch: (event: EventName, input: EventInput, coreResult?: EventResult) => Promise<EventResult>;
    readonly hooks: HooksRegistry;
}
/**
 * 与 `createHarness` 等价，但 `$` 是惰性代理：任何方法首次被调用时才 fold，
 * 这样测试可以「先 `on(...)` 铺世界层、后 `await $.xxx()`」，与官方写法一致。
 */
export declare function harness(options: HarnessOptions): LazyHarness;
/** `mock.clock` 的句柄。 */
export interface MockClock {
    /** 当前虚拟时间。 */
    now: () => number;
    /** 推进虚拟时间，兑现所有到期的 sleep/after/every。 */
    advance: (ms: number) => Promise<void>;
    /** 让已 start 的 dispatch 有机会推进到下一个 await 点（时钟不动）。 */
    settle: () => Promise<void>;
}
/**
 * 从内存应答世界层的 noun。每个成员都是一个把 hook 注册到 `on` 上的普通函数 ——
 * 与官方「each member a plain function over `on`」一致。
 */
export declare const mock: {
    /** `$.env.get` / `$.env.set` 走内存变量表。 */
    env(on: On, variables?: Record<string, string>): void;
    /** `$.store.*` 走内存 KV。 */
    store(on: On, entries?: Record<string, unknown>): void;
    /** `$.clock.*` 走虚拟时钟；`advance(ms)` 兑现到期的等待。 */
    clock(on: On, options?: {
        startMs?: number;
    }): MockClock;
};
/** 声明被测 mod 所在的层（对齐官方 `tier('builtin')`）。 */
export declare function tierOf(t: Tier): Tier;
//# sourceMappingURL=harness.d.ts.map