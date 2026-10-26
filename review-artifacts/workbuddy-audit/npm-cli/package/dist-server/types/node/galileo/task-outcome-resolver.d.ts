/**
 * TaskOutcomeResolver — 独立的 outcome 解析器
 *
 * 将 stopReason + errorMessage(category) + ErrorSnapshot 三个信号源
 * 组装为 TaskOutcomeContext，然后调用已有的 determineTaskOutcome()。
 *
 * 独立模块，不修改 task-outcome.ts 的判定逻辑。
 */
import type { StopReason } from '@genie/agent-client-protocol';
import type { ErrorSnapshot } from './session-error-tracker';
import { TaskOutcome } from './task-outcome';
/**
 * 根据 prompt 结束时的多维信号精细判定 TaskOutcome。
 *
 * @param stopReason   - ACP 协议的 stopReason
 * @param errorMessage - createEventForwardingPromise 传回的 errorMessage（JSON-RPC 格式或纯文本）
 * @param errorSnapshot - SessionErrorTracker 的快照
 */
export declare function resolveTaskOutcome(stopReason: StopReason, errorMessage: string | undefined, errorSnapshot: ErrorSnapshot): TaskOutcome;
/**
 * 从 errorMessage JSON 中提取 category 字段。
 *
 * errorMessage 格式（由 classifyErrorAsRequestError().toErrorResponse() 生成）：
 *   { "code": -32001, "message": "...", "data": { "category": "network", ... } }
 * 或嵌套：
 *   { "error": { "code": ..., "data": { "category": "..." } } }
 */
export declare function extractCategoryFromErrorMessage(errorMessage: string | undefined): string | undefined;
