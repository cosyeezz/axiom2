import type { Session } from './session-protocol';
/**
 * Shared retry-budget predicate for network error auto-retry.
 *
 * 计数存在 `session.meta` 上，同一次逻辑恢复链内最多重试 3 次。原先靠扫描最近 3 条
 * 历史里的恢复文案判重，只能表达「有没有重试过」，数不出次数；换文案后扫描恒为 0，
 * 上限会静默失效。
 *
 * 清零只发生在逻辑恢复链真正结束时（run 以最终输出收尾、或新的外部用户请求开始），
 * 不在每次物理 run 失败时清零——网络失败本身就结束了一个物理 run，若在那里清零，
 * 每次失败都会先清零再认领，上限永远累计不起来。
 *
 * `interruption-service` and `session-manager` must agree on this predicate so
 * terminal results are suppressed only while a retry will actually be scheduled.
 * 两边判定分叉的后果是真实故障而非理论风险：gate 若单方面认定"会重试"，
 * 而 interruption-service 因预算耗尽实际不重试，则 acp-agent 会一直等待那个
 * 永不到来的重试、不下发终态 RESULT——`session/prompt` 响应永不写回，UI 停在
 * loading 直到用户手动 stop；且 `executePrompt` 阻塞会让 acp-view 的 render
 * for-await 停转，后续 prompt 全部 park 在 promptQueue 里无人消费。
 */
export declare function hasExhaustedNetworkErrorRetryBudget(session: Session): boolean;
export declare function claimNetworkErrorRetry(session: Session): number | undefined;
export declare function releaseNetworkErrorRetry(session: Session): void;
export declare function resetNetworkErrorRetryBudget(session: Session): number;
//# sourceMappingURL=network-error-retry-budget.d.ts.map