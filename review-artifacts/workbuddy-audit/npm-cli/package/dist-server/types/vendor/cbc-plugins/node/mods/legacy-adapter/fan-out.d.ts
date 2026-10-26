import { HookEvent, type HookExecutionResult } from '../../../../cbc-shared/node/index.js';
import type { HooksRegistry } from '../engine';
import type { EventResult } from '../types';
/**
 * 广播 `classic.<Event>` 并返回 middleware 侧的原始决策（classic 结果形状）。
 *
 * cbc 老 shell hooks 由 `HookManager` 先执行；本函数把同一次触发也分发成
 * `classic.<Event>` middleware 事件。链是 [...mods, core]，`core` 层就是宿主 shell
 * hook 的结果（对齐官方「其余 settings hooks 作为 core」），这样
 * `next.to(e, 'append')` / `await next(e)` 都能拿到宿主结论。
 *
 * caller 应在 `isFunctionHooksEnabled()` 为 true 时才调用，否则整包旁路。
 */
export declare function dispatchLegacyEvent(registry: Pick<HooksRegistry, 'dispatch'>, event: HookEvent, input: Readonly<Record<string, unknown>>, legacyResult?: HookExecutionResult): Promise<EventResult>;
/**
 * 分发 `classic.<Event>` 并把链的最终结果折回宿主 `HookExecutionResult`。
 *
 * 折回规则见 `applyClassicVerdict`：mod 只能收紧宿主决策，`updatedInput` /
 * `additionalContext` 等改写按官方语义生效。
 */
export declare function dispatchClassicHook(registry: Pick<HooksRegistry, 'dispatch'>, event: HookEvent, input: Readonly<Record<string, unknown>>, hostResult: HookExecutionResult, signal?: AbortSignal): Promise<HookExecutionResult>;
/**
 * 只广播、不取决策的形态：老 shell hook 的执行流完全不受 middleware 返回影响。
 *
 * 适合「先让 mod 观察，再逐步把决策权交给 middleware」的灰度阶段。
 */
export declare function fanOutLegacyEvent(registry: Pick<HooksRegistry, 'dispatch'>, event: HookEvent, input: Readonly<Record<string, unknown>>): Promise<void>;
//# sourceMappingURL=fan-out.d.ts.map