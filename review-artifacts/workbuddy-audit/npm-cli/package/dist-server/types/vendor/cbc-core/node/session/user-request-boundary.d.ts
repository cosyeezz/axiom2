import { Logger } from '@genie/telemetry';
import type { Session } from './session-protocol';
/**
 * 标记「一个新的外部用户请求开始」，重置只在单个 request 内有意义的运行时状态，
 * 并记录本回合的度量起点（`session.currentTurn`）。
 *
 * 为什么需要统一收口：这类状态原先只在 ACP 的 `executePrompt` 里内联重置，而
 * remote-control（微信 / 企微）、TUI、remote-gateway、headless 都是直连
 * `agentService.runDefault`，绕过了该入口。`consecutiveMaxTokenCompactCount`
 * 因此可能被打满后再也回不去，会话永久失去上下文压缩能力。所有入口都必经
 * `SessionManager.addHistory`，故以那里的「外部用户输入」判定为统一边界。
 *
 * 幂等：可重复调用，无副作用。
 *
 * @param session 目标会话（主 session 或 subagent session 各自持有独立状态）
 * @param logger 可选日志；仅在确有状态被清理时输出，便于事后从日志确认重置生效
 */
export declare function beginExternalUserRequest(session: Session, logger?: Logger): void;
/**
 * 丢弃没被任何 prompt 响应消费的取消原因（`session.meta[ACP_META_CANCEL_REASON]`）。
 *
 * 只能在 ACP prompt 串行边界调用：此时上一个 prompt 的响应已组装完毕，残留原因
 * 必然来自不经 prompt 响应收口的 run（排队 drain、TUI / headless），留着会让本轮
 * 的普通取消被标成上一轮的原因。
 *
 * 幂等：可重复调用。
 */
export declare function discardStaleCancelReason(session: Session, logger?: Logger): void;
/**
 * 给「非用户发起的运行」补一个回合度量起点——**仅在槽位空着时**。
 *
 * 为什么需要：后台任务完成后触发的 drain 运行会做实事（读输出、改文件、汇报结论），
 * 但它不是用户发起的，走不到 {@link beginExternalUserRequest}，于是 TurnMetricsReporter
 * 以 `no-turn-start` 跳过，这段工作在界面上完全没有耗时记录。实测有一次会话在这类
 * 运行里连续干了 110 秒，一条线都没有。
 *
 * 为什么必须带 `if (session.currentTurn)` 早退，两个原因缺一不可：
 * 1. 压缩中 / 待重试的回合被判为「非终态跳过」时，槽位会刻意保留着等续跑
 *    （见 TurnMetricsReporter 的 isTerminalSkip）。这里顶掉它会让那一轮丢失起点。
 * 2. drain 路径也会消费排队的**真实用户消息**，那种情况下 `beginExternalUserRequest`
 *    会在运行中把起点覆盖成更准确的值，这里抢先写只是无谓的中间态。
 *
 * 幂等：可重复调用。
 */
export declare function ensureTurnStart(session: Session, logger?: Logger): void;
//# sourceMappingURL=user-request-boundary.d.ts.map