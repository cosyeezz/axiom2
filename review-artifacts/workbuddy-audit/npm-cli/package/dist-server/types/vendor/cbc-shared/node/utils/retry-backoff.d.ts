/**
 * 自动恢复链的统一口径：最多 3 次，1s 起步、2 倍指数退避（基准 1s → 2s → 4s）。
 *
 * 适用于会话层的 error / 网络 / 流超时恢复，以及模型层的连接级透明重试。
 * 第 1 层请求级（429/502/503 等）不带网关 retry_policy 时仍保持自己的 500ms 基数，
 * 所以这里只共享算法，基数与上限由调用方传入。
 */
export declare const MAX_RECOVERY_RETRIES = 3;
export declare const RECOVERY_RETRY_BASE_DELAY_MS = 1000;
export declare const RECOVERY_RETRY_MAX_DELAY_MS = 32000;
export interface ExponentialBackoffOptions {
    baseDelayMs: number;
    maxDelayMs: number;
    random?: () => number;
}
/**
 * `base * 2^(attempt-1)` 封顶到 `maxDelayMs`，再做 25% 下减抖动（区间 `[0.75x, 1x]`）。
 *
 * 必须下减而不是上加：上加会让实际等待越过 `maxDelayMs` 25%，调用方对封顶的承诺就不成立。
 * `attempt` 从 1 起，小于 1 按 1 处理。
 */
export declare function computeExponentialBackoffMs(attempt: number, options: ExponentialBackoffOptions): number;
export declare function computeRecoveryBackoffMs(attempt: number, random?: () => number): number;
/**
 * 可取消的等待。`signal` 在等待前或等待中 abort 时返回 `false`，正常等满返回 `true`。
 *
 * 返回布尔而不是 reject：恢复链上的调用方拿到 `false` 后要自己决定退还额度、跳过发起，
 * 用异常表达会把「用户取消」和「真正的错误」混在一条 catch 路径里。
 */
export declare function waitForRecoveryBackoff(ms: number, signal?: AbortSignal): Promise<boolean>;
//# sourceMappingURL=retry-backoff.d.ts.map