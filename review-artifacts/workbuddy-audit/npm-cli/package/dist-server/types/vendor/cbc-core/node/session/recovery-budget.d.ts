import type { Session } from './session-protocol';
/**
 * `finish_reason=error` 三种表现（已有输出 / 仅 reasoning / 零 token）共用的预算键。
 *
 * 三者是同一次上游故障的不同形态，而且会在恢复过程中互相转化（第一次零 token、
 * 重试后只吐 reasoning、再重试吐了内容后又 error）。各记各的会让一次故障的总轮数
 * 远超约定上限，所以必须认领同一个键。
 */
export declare const ERROR_RECOVERY_COUNT_META_KEY = "errorRecoveryCount";
/**
 * 流开始之后的网络错误（错误仍带原始 errno）使用的预算键。
 *
 * 响应头之前的连接失败由模型层连接级重试处理，耗尽后被归一化成 HTTP 502 上抛，
 * 不会再走到这里——两层不会为同一次失败接力。
 */
export declare const NETWORK_RECOVERY_COUNT_META_KEY = "networkErrorRetryCount";
/**
 * `finish_reason=error` 后注入给模型的续写提示。
 *
 * 与截断续写（TRUNCATION_CONTINUATION_PROMPT）的区别是刻意去掉了「把剩下的工作拆小」：
 * 那句是在修「一次输出太长」的因果，上游内部错误与输出长度无关，带上它既是错误归因，
 * 也可能让模型把任务切碎、多烧轮次。同样不告诉模型「是服务端出错」——那会给它道歉和
 * 复述的由头，与 no apology / no recap 自相矛盾。
 */
export declare const ERROR_RECOVERY_PROMPT: string;
/**
 * 包成 error-recovery system-reminder：stream-json 等输出通道会把只含 system-reminder
 * 的内部用户消息清空丢弃，避免恢复提示混进用户可见的对话。
 */
export declare function buildErrorRecoveryReminder(): string;
export declare function readRecoveryBudgetCount(session: Session, key: string): number;
export declare function hasExhaustedRecoveryBudget(session: Session, key: string, limit?: number): boolean;
/**
 * 同步完成「判定 + 认领」，返回本次恢复的序号（1-based）；预算已用尽返回 `undefined`。
 *
 * 判定与消耗必须在同一个同步段里完成：分散到 `await` 两侧时，两处调用可能同时在
 * `count = limit - 1` 通过检查，上限就不再成立。
 */
export declare function claimRecoveryBudget(session: Session, key: string, limit?: number): number | undefined;
/** 认领后没有真正发起恢复（退避期间被取消、发起失败）时退回额度。 */
export declare function releaseRecoveryBudget(session: Session, key: string): void;
/** 清零并返回旧值，供日志使用。 */
export declare function resetRecoveryBudget(session: Session, key: string): number;
/**
 * 「下一个模型请求是自动恢复轮」的一次性标记。
 *
 * 恢复轮的首 token 时限比首次请求短（见模型层）。这个标记在发起恢复 run 前由恢复
 * 入口显式写入，由模型层在该 run 的第一个模型请求上读取并清除——之后同一 run 的工具
 * 循环请求回到普通时限。不能改用重试计数反推「是否恢复轮」：计数跨多个模型请求累计，
 * 反推会让恢复链之后的所有请求都被当成恢复轮。
 */
export declare const RECOVERY_REQUEST_PENDING_META_KEY = "recoveryRequestPending";
export declare function markRecoveryRequestPending(session: Session): void;
export declare function consumeRecoveryRequestPending(session: Session | undefined): boolean;
export declare function clearRecoveryRequestPending(session: Session): void;
//# sourceMappingURL=recovery-budget.d.ts.map