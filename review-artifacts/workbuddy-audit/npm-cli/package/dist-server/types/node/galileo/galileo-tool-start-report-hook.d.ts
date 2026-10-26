/**
 * Tool PreToolUse → Galileo Log（`agent.tool.start_detail`）
 *
 * 与 `galileo-tool-pre-hook` 区分：那条算 metrics（startTime / 计数），本 hook 走
 * 详情视图（含 tool_name / agent_name / scene 等多维度，便于搜索与下钻）。
 */
import { HookEvent, HookExecutionResult } from '../../vendor/cbc-shared/node/index.js';
import { Hook, HookInput, HookPriority } from '../hooks/hook-protocol';
export declare class GalileoToolStartReportHook implements Hook {
    readonly event = HookEvent.PRE_TOOL_USE;
    readonly priority = HookPriority.Low;
    private readonly bridge;
    execute(input: HookInput): Promise<HookExecutionResult | undefined>;
}
