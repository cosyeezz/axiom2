/**
 * Task Outcome — Agent 任务最终结果判定
 *
 * 根据 session history 中的模型响应和工具执行结果，判定本次 task 的 outcome。
 * 用于 SLA 聚合上报。
 */
export type TaskOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED_MODEL_REQUEST' | 'FAILED_TOOL_EXECUTION' | 'FAILED_AGENT_LOOP' | 'REFUSED_OR_BLOCKED' | 'CANCELLED' | 'PERMISSION_DENIED' | 'UNKNOWN';
export interface TaskOutcomeContext {
    /** 是否有模型正常返回 stop/end_turn */
    hasFinalAnswer: boolean;
    /** 是否有未恢复的模型请求错误 */
    hasUnrecoveredModelError: boolean;
    /** 是否有未恢复的工具执行错误 */
    hasUnrecoveredToolError: boolean;
    /** 是否被用户主动取消 */
    wasCancelled: boolean;
    /** 是否触发了 agent loop 限制（maxSteps / maxTurns） */
    hitLoopLimit: boolean;
    /** 是否被安全策略拒绝 */
    wasRefused: boolean;
}
/**
 * 根据上下文判定 Task Outcome。
 *
 * 判定优先级：
 *   1. 用户取消 → CANCELLED
 *   2. 安全策略拒绝 → REFUSED_OR_BLOCKED
 *   3. 有 finalAnswer 且无错误 → SUCCESS
 *   4. 有 finalAnswer 但有错误 → PARTIAL_SUCCESS
 *   5. 无 finalAnswer + 模型错误 → FAILED_MODEL_REQUEST
 *   6. 无 finalAnswer + 工具错误 → FAILED_TOOL_EXECUTION
 *   7. 触发循环限制 → FAILED_AGENT_LOOP
 *   8. 兜底 → UNKNOWN
 */
export declare function determineTaskOutcome(ctx: TaskOutcomeContext): TaskOutcome;
