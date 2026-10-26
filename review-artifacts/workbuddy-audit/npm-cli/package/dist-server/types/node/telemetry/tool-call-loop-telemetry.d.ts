import type { ToolCallLoopEventKind, ToolCallLoopEvidence } from '../../vendor/cbc-core/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { type EventService, type Logger } from '@genie/telemetry';
export type { ToolCallLoopEventKind, ToolCallLoopEvidence } from '../../vendor/cbc-core/node/index.js';
/**
 * 上报工具调用循环事件（loop_suspected / loop_continue / loop_auto_continue / loop_detected）。
 *
 * `continue` 与 `auto_continue` 必须分开：前者是用户在弹窗上真的点了继续，后者是压根没弹出
 * 窗（headless / 后台任务 / 子会话 / 取不到 ACP agent）后的自动放行。混成一个事件的话，
 * 「继续比例」会把没人问过的那部分算成用户选择，`loop_suspected` 也不再等于弹窗触发次数——
 * 更糟的是弹窗链路真出故障（比如客户端重连后解析不到 agent）时大盘毫无变化，无从发现。
 *
 * 与 `user_task_failed_credit_refund` 的关系：这几个事件只做观测，用来算「弹窗触发次数」
 * 以及继续/停止比例；真正的退费仍然只由 `reportUserTaskFailedCreditRefund` 触发，两条链路
 * 各自独立，避免观测口径变化影响计费。
 *
 * 与退费累加器不同，这里刻意不做任何 `abortSignal` / `userInitiatedAbort` 过滤：
 * `loop_detected` 恰好发生在用户主动停止之后，如果套用退费那套跳过规则就永远上报不出去。
 */
export declare function reportToolCallLoopEvent(kind: ToolCallLoopEventKind, session: Session, evidence: ToolCallLoopEvidence, eventService: EventService | undefined, logger: Logger): Promise<void>;
