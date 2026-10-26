import { HookEvent, type HookExecutionResult } from '../../../../cbc-shared/node/index.js';
import type { ClassicEventName, EventInput, EventResult } from '../types';
/**
 * 把 cbc 老 `HookEvent` 枚举值映射为 claude-code 风格的 `classic.<Event>` 事件名。
 *
 * 用于 legacy adapter：当 `SessionHookManager` 执行完一次 shell hook，
 * 用这个 mapping 把结果广播到 cbc-mods middleware 引擎。
 */
export declare function classicEventNameOf(event: HookEvent): ClassicEventName;
/**
 * classic 事件的 `e`（对齐官方 `ClassicEventOf`）。
 *
 * - `classic.PreToolUse`：`ToolCallEnvelope` —— `{ tool, tool_use_id, ...args }`，
 *   与 `tool.call` 同形（官方 `IAt(tool_name, tool_use_id, toolInput)`）。
 * - 其余：classic hook 在 stdin 上收到的形状。宿主内部的 `session` 对象不是 stdin
 *   的一部分（`HookExecutor` 序列化前同样剥掉），不能漏给第三方 mod。
 */
export declare function toClassicInput(event: HookEvent, input: Readonly<Record<string, unknown>>): EventInput;
/**
 * 宿主 shell hook 的聚合结果 → classic 链 `core` 层结果（对齐官方 `ClassicResultOf`）。
 *
 * mod 写 `const r = await next(e)` 时拿到的就是它：PreToolUse 是
 * `PreToolUseResult`（`allow` / `ask` / `deny` + `updatedInput` / `additionalContext`），
 * 其余事件是 `ClassicResult` 的子集。
 */
export declare function toClassicResult(event: HookEvent, host: HookExecutionResult): EventResult;
/** 一次 classic 分发里 core 层实际收到的 `e`：mod 用 `next(e')` 改写时它就是 `e'`。 */
export interface ClassicCoreTrace {
    readonly envelope: EventInput;
    coreInput?: EventInput;
}
/**
 * 构造 classic 链的 `core` 层。
 *
 * PreToolUse 下 mod 用 `next({ ...e, command })` 改写时，宿主 shell hook 已经跑在原始
 * 参数上，这里把改写后的参数作为基底、宿主自己的 `updatedInput` 叠在上面 —— 等价于
 * 官方「core 的 settings hook 跑在 e' 上」：mod 的改写被保留，宿主的改写仍最后生效。
 */
export declare function classicCore(event: HookEvent, host: HookExecutionResult, trace: ClassicCoreTrace, toolInput: unknown): (e: EventInput) => EventResult;
/**
 * classic 链的最终结果 → 宿主 `HookExecutionResult`。
 *
 * ## mod 只能收紧，不能放松
 *
 * 宿主 shell hook 是用户/企业自己的安全边界：
 *
 * | 字段 | 规则 |
 * |---|---|
 * | `deny` / `block` / `preventContinuation` | mod 给出即采纳（收紧） |
 * | `ask` | 宿主未拒绝、也未要求确认时采纳（收紧成「先问用户」） |
 * | `allow` | **忽略**：mod 不能替用户免除权限确认 |
 * | `updatedInput` | 采纳；宿主自己的改写叠在上面，最后生效 |
 * | `additionalContext` | 宿主 + mod 合并去重 |
 * | 其余事件字段 | 宿主已给出的以宿主为准，mod 只能补空缺；`decision` 仅采纳 deny |
 *
 * 宿主已拒绝时原样返回宿主结果（mod 说什么都不放行，理由也保持宿主自己的）。
 */
export declare function applyClassicVerdict(event: HookEvent, host: HookExecutionResult, verdict: EventResult, trace?: ClassicCoreTrace, toolInput?: unknown): HookExecutionResult;
//# sourceMappingURL=hook-result-mapper.d.ts.map