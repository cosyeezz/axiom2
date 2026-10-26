import type { Session } from './session-protocol';
/**
 * Shared retry-budget predicate for stream timeout auto-retry.
 *
 * `interruption-service` and `session-manager` must agree on this predicate so
 * terminal results are suppressed only while a retry will actually be scheduled.
 */
export declare function hasExhaustedStreamTimeoutRetryBudget(session: Session, isFirstTokenTimeout: boolean): boolean;
/**
 * `finish_reason=error` 且没有可用输出的两种空流：reasoning-only 与 no-token。
 * placeholder（空 200 / 心跳帧）仍是会话层终态，由拦截器切一次备站。
 *
 * 额外的时长闸门（#132616）：这两种 kind 之所以可重试，前提是「上游瞬时失败」——秒级
 * 空响应重跑一次大概率就好了。但当这条流已经跑满上游的硬时限才收到 error 时，前提不成立：
 * 同一段 prompt 重跑必然再次跑满同一个时限。实测 7 个会话全部重试、全部再次撞墙、0 次恢复，
 * 而 `#130098` 把预算从 1 提到 3 之后，同样的输入会从 2×900s 变成 4×900s ≈ 60 分钟静默。
 * 重试的期望收益不随 elapsed 增长，成本却线性增长，所以按 elapsed 收口。
 */
export declare function isRetryableEmptyStreamError(error: unknown): boolean;
/**
 * Empty 200 / placeholder-only：拦截器最多切一次备站，会话层终态（#115866）。
 * reasoning-only / no-token + finish_reason=error：上游瞬时失败，按 error 预算重试；
 * 已烧满上游硬时限的那些除外，见 {@link isRetryableEmptyStreamError} 的时长闸门（#132616）。
 * 流空闲超时 / 首 token 超时：按各自的超时预算重试。
 */
export declare function shouldAutoRetryStreamTimeout(session: Session, error: unknown): boolean;
/**
 * 为一次流错误恢复认领额度，返回序号（1-based）；不可重试或已耗尽返回 `undefined`。
 * 调用方必须先用 {@link shouldAutoRetryStreamTimeout} 判定，本函数只负责同步认领。
 */
export declare function claimStreamRecoveryAttempt(session: Session, error: unknown): number | undefined;
/** 认领后没有真正发起恢复时退回额度。 */
export declare function releaseStreamRecoveryAttempt(session: Session, error: unknown): void;
//# sourceMappingURL=stream-timeout-retry-budget.d.ts.map