/**
 * Tool 失败两路 → Galileo Log（`agent.tool.error_detail`）
 *
 * - 路径①（PostToolUse + `is_error=true`）：tool 内部捕获错误转成"成功响应+错误标记"
 *   → `error_source = response_flag`
 * - 路径②（PostToolUseFailure）：tool 真正抛异常 → `error_source = thrown`
 *
 * 用户主动取消（`is_interrupt=true`）不上报，避免污染错误率（与 chat-reporter 对齐）。
 */
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
/**
 * 从 tool_response._meta 提取 connector 真实 serverShortName（connector-proxy 回传）。
 * 用于把 connector capability_id 从占位 connector-proxy 升级为真实 id。
 */
export declare function extractConnectorServer(toolResponse: unknown): string | undefined;
/** 路径①：PostToolUse + tool_response.is_error=true → error_source=response_flag */
export declare class GalileoToolResponseErrorReportHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE;
    readonly priority = HookPriority.Low;
    private readonly bridge;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
/** 路径②：PostToolUseFailure → error_source=thrown（用户取消除外） */
export declare class GalileoToolThrownErrorReportHook implements Hook {
    readonly event = HookEvent.POST_TOOL_USE_FAILURE;
    readonly priority = HookPriority.Low;
    private readonly bridge;
    private readonly aggregator;
    private readonly sessionErrorTracker;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
