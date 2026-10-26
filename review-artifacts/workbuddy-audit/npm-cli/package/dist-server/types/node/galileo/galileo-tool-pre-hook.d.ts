import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
/**
 * Galileo Tool Pre Hook
 *
 * Runs on PreToolUse to record tool start time for duration metrics,
 * and count tool_calls generated for callback rate calculation.
 *
 * 与 trace 的 ToolExecutionPreHook 解耦：trace hook 负责 span，本 hook 负责 Galileo 打点。
 */
export declare class GalileoToolPreHook implements Hook {
    readonly event = HookEvent.PRE_TOOL_USE;
    readonly priority = HookPriority.Low;
    private readonly aggregator;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
