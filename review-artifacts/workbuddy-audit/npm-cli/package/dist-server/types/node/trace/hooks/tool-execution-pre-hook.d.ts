import { HookEvent, HookExecutionResult } from '../../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../../hooks/hook-protocol';
/**
 * Tool Execution Pre Hook
 *
 * Runs on PreToolUse to create a child span from the root span.
 * The span stays OPEN during tool execution and is closed by ToolExecutionPostHook.
 */
export declare class ToolExecutionPreHook implements Hook {
    readonly event = HookEvent.PRE_TOOL_USE;
    readonly priority = HookPriority.High;
    private _flags?;
    private get flags();
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
    /**
     * 视图模式：创建 step-N -> tool-call_<name> -> parse-parameter-<name> / execute-tool-call-<name> 链路。
     * 开关关闭时不会进入此方法。工具属性（名称/callId/输入）挂在 toolCallSpan / executeSpan 上。
     */
    private maybeStartGalileoViewSpans;
}
