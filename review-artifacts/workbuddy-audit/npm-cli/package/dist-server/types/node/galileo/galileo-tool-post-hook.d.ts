import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
/**
 * Galileo Tool Post Hook
 *
 * Runs on PostToolUse to record tool execution duration and tool result.
 *
 * 与 trace 的 ToolExecutionPostHook 解耦：trace hook 负责 span，本 hook 负责 Galileo 打点。
 */
export declare class GalileoToolPostHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly priority = HookPriority.Low;
    private readonly galileo;
    private readonly aggregator;
    private readonly sessionErrorTracker;
    private readonly bridge;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
