import { type HookInput } from '../../vendor/cbc-core/node/index.js';
import { HookEvent, type HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
/**
 * 把既有 shell hook 的每一次触发也广播成 `classic.<Event>`。
 *
 * 官方 `sec-default` 就写着 `on('classic.*', ($, e, next) => next.to(e, 'append'))`
 * —— 新架构的 mod 需要能观察并参与老 hook 的决策，否则两套机制各说各话。
 *
 * 事件形态与结果形态都对齐官方类型：`classic.PreToolUse` 的 `e` 是 ToolCallEnvelope
 * （`{ tool, tool_use_id, ...args }`），返回 PreToolUseResult（`deny` / `ask` /
 * `updatedInput` / `additionalContext`）；其余事件是 stdin 形态 + ClassicResult。
 * 映射与折回规则在 `Mods.dispatchClassicHook` / `applyClassicVerdict`。
 *
 * ## mod 只能收紧，不能放松
 *
 * 老 shell hook 是**宿主自己**的安全边界（用户在 settings 里写的 PreToolUse 拒绝、
 * 企业策略、权限检查）。mod 的拒绝 / 要求确认会被采纳；mod 的 `allow` 不能免除权限
 * 确认；宿主已拒绝时原样返回宿主结果（理由也保持宿主自己的那条）。
 *
 * ## 未启用时零开销
 *
 * 没有 mods 运行时就原样返回宿主结果：不构造事件、不进引擎。
 */
export declare function throughModsClassicHook(event: HookEvent, input: HookInput, hostResult: HookExecutionResult): Promise<HookExecutionResult>;
