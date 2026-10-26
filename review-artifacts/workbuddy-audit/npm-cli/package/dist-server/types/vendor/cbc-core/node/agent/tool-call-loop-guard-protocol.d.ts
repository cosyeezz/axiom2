import type { FunctionCallItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
export declare const ToolCallLoopGuard: unique symbol;
export type ToolCallLoopGuardDecision = 'proceed' | 'stop';
/**
 * 用户选择停止循环时，各记账点抛出的 Error message。
 *
 * **受众是模型，不是用户**：它经 `BaseTool.errorFunction` / agents-core 的
 * `defaultToolErrorFunction` 兜成工具输出字符串，不会冒泡到 request 层，
 * 因此不做 i18n（与 `INTERRUPTED_BY_USER_MESSAGE` 同口径）。
 *
 * 用户可见的一侧走另一条完全独立的路径，且已有稳定标识：卡片由
 * `TOOL_CALL_LOOP_INTERCEPT_TYPE` 分流，取消原因由 `ToolCallLoopGuardImpl.cancelTurn`
 * 经 `ACP_META_CANCEL_REASON: ACP_CANCEL_REASON_TOOL_CALL_LOOP_STOPPED` 带出。
 * 改这里的文案不影响 UI，改那两个常量才影响。
 *
 * 提成常量是为了让 tool-manager 与 mcp-server-manager 两个抛出点不漂移。
 * 若将来让本错误冒泡到 request 层，必须同步给 `classifyErrorDetail` 的取消分支
 * 加匹配 —— 它对取消是精确匹配 'request aborted.' / 'request was aborted.'，
 * 本 message 会落到兜底 internal_unknown，被当成真实错误污染伽利略错误率。
 */
export declare const TOOL_CALL_LOOP_STOPPED_MESSAGE = "Request aborted: user stopped a suspected tool call loop.";
/**
 * 工具执行前的循环闸门。
 *
 * 与 `ToolCallLoopDetector` 的分工：
 * - `ToolCallLoopDetector` 在**模型请求前**拦截，静默向模型注入停止消息，用户无感；
 *   它覆盖的是旧的三条规则（黑名单同参 4 次 / Read 同文件 40 次 / 非黑名单同参 40 次）。
 * - `ToolCallLoopGuard` 在**工具执行前**拦截，弹窗让用户自己决定继续还是停止；
 *   它覆盖新增的两条规则（同工具连续 40 次，Bash 与 Write 单独放到 80 次 / 周期序列重复 10 轮）。
 *
 * 两者刻意并存：旧规则的静默语义已被线上验证，不因新能力回归。
 */
export interface ToolCallLoopGuard {
    /**
     * 在工具真正执行前记账并判定。
     *
     * 返回 `'proceed'` 表示放行（未命中、宿主不适用、或用户选择继续）；
     * 返回 `'stop'` 表示用户选择停止请求，调用方必须放弃本次工具执行。
     */
    checkBeforeExecute(session: Session, toolName: string, toolCall?: FunctionCallItem): Promise<ToolCallLoopGuardDecision>;
}
//# sourceMappingURL=tool-call-loop-guard-protocol.d.ts.map