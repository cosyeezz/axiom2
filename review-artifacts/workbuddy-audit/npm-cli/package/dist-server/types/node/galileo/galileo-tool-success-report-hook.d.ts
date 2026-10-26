/**
 * Tool PostToolUse（非 error）→ Galileo Log（`agent.tool.success_detail`）
 *
 * `tool_response.is_error=true` 由 `GalileoToolErrorReportHook` 处理，两路严格互斥。
 * 耗时取自 `session._toolStartTimes`（由 `GalileoToolPreHook` 写入），本 hook 只读不删。
 */
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
export declare class GalileoToolSuccessReportHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly priority = HookPriority.Low;
    private readonly bridge;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
