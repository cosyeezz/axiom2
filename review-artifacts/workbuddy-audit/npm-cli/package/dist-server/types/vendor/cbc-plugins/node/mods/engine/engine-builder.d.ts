import type { EngineInterface, RegisteredMod, Tier } from '../types';
import { type HooksRegistry } from './hooks-registry';
/** 判断一个值是否 withhold 占位。 */
export declare function isWithheld(v: unknown): boolean;
/**
 * 构造 `$` —— 每个方法都经 `registry.dispatch()`，因此上层 mod 可以拦截、
 * 改写、拒绝任何一次能力调用（`sec-default` 式管控 / 审计 mod 的基础）。
 *
 * 两类方法：
 * - **Op 方法**（`OP_TABLE`）：分发 `<noun>.<op>` op 事件，结果取 `{ value }`；
 *   `{ deny }` 则抛错（调用方视为能力被拒）。
 * - **Event call 方法**（`EVENT_CALL_TABLE`）：分发 middleware 事件，
 *   原样返回事件结果（`tool.call` / `command.run` / `session.start` …）。
 *
 * 每次分发都带上 `origin = { plugin, tier }` —— 官方语义里 `next.origin` 是
 * **发起调用的那个 plugin**，`sec-default` 的 `tool.register` 就靠它判断
 * 「调用者是组织装的还是用户装的」。
 *
 * @param registry 事件引擎
 * @param plugin 该 `$` 所属 plugin 的身份（name / root / tier）
 */
export declare function buildBaseSurface(registry: HooksRegistry, plugin: {
    readonly name: string;
    readonly root: string;
    readonly tier?: Tier;
}): EngineInterface;
/** `engine.create` fold 期间发现的违规。 */
export interface NounViolation {
    /** 被试图替换的 noun。 */
    readonly noun: string;
    readonly reason: string;
}
/**
 * 跑 `engine.create` fold 组装最终 `$`。
 *
 * 语义对齐官方：
 * - `next(e)` 直接 resolve 成 **`$` 本身**（`NextResult<'engine.create'> =
 *   EngineInterfaceBuilt`），所以官方 mod 的 `{ ...await next(e), telemetry }`
 *   能原样工作。
 * - 一个 step **可以 ADD** noun
 * - 一个 step **可以 WITHHOLD** noun（返回时不带某个 key，或不调 `next`）
 * - 一个 step **不可 REPLACE** core 提供的 noun
 * - fold 完成后 `$` 冻结
 *
 * ## 违规不连坐
 *
 * 试图替换 core noun 时**不让整个 fold 失败** —— fold 走的是整条 `engine.create`
 * 链（含所有 mod 的 step），一个 mod 的违规若抛错，会让**其他无辜 mod 和 host
 * 都拿不到 `$`**。正确的隔离是：丢弃违规那个 noun（换回 core 的原值），通过
 * `onViolation` 报出来，fold 照常完成。
 *
 * @param registry 事件引擎（已 register 全部 mod）
 * @param mods 参与 fold 的 mod 名单（决定 `engine.create` 的 `plugins` 入参）
 * @param plugin 这份 `$` 归属的 plugin（含 tier，用于 `next.origin`）
 * @param onViolation 发现违规时的回调（不传则静默丢弃）
 */
export declare function buildEngineInterface(registry: HooksRegistry, mods: readonly RegisteredMod[], plugin: {
    readonly name: string;
    readonly root: string;
    readonly tier?: Tier;
}, onViolation?: (violation: NounViolation) => void, strict?: boolean): Promise<EngineInterface>;
//# sourceMappingURL=engine-builder.d.ts.map