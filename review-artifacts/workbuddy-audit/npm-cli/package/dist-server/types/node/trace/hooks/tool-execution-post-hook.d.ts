import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
/**
 * Tool Execution Post Hook
 *
 * Runs on PostToolUse to close the child span created by ToolExecutionPreHook.
 * When OTEL_LOG_TOOL_CONTENT is enabled, records tool output before closing the span.
 */
export declare class ToolExecutionPostHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly priority = HookPriority.High;
    private _flags?;
    private get flags();
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    /**
     * 关闭 Galileo 视图 span 链路：先记录 tool_response 到 executeSpan，再反序关闭。
     * 开关关闭时不会进入此方法。
     */
    private maybeCloseGalileoViewSpans;
}
