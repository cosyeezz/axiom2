export type NetworkFailureKind = 'timeout' | 'dns' | 'unreachable' | 'refused' | 'tls' | 'reset' | 'unknown';
export declare const NETWORK_FAILURE_CODES_BY_KIND: Readonly<Record<Exclude<NetworkFailureKind, 'unknown'>, readonly string[]>>;
export declare function classifyNetworkFailure(code?: string, message?: string): NetworkFailureKind;
export declare function isTlsCertificateFailure(code?: string, message?: string): boolean;
export declare function isDirectFallbackConnectionFailure(code?: string, message?: string): boolean;
export declare function isPreResponseRetryableNetworkFailure(code?: string, message?: string): boolean;
export declare function isRequestLevelRetryableStatus(status?: number): boolean;
/**
 * 从响应头解析 `retry-after`（RFC 9110：秒数或 HTTP-date）为毫秒。
 *
 * 兼容三种 headers 形态：普通对象（axios error.response.headers）、Headers 实例（fetch）、
 * 以及大小写混用的 key。非法值、负数、0 与已过去的日期返回 null，交给调用方回退到指数退避。
 * 这里不封顶：服务端要求等多久由调用方决定是否尊重。
 */
export declare function parseRetryAfterMs(headers: Record<string, unknown> | Headers | undefined | null, now?: number): number | null;
/**
 * （Q1 可选增强 / 接口预留）解析额度窗口"重置时间"响应头，返回距 `now` 的等待毫秒。
 *
 * 与 parseRetryAfterMs 的区别：retry-after 是"过多久再试"的相对秒数；本头是"额度窗口何时重置"
 * 的**绝对时间点**（Unix 秒或 HTTP-date），对齐 Claude Code 的 `getRateLimitResetDelayMs` 语义。
 * 仅在 watchdog 无限重试且判定为"可等待的窗口限流"时用它替代指数退避（由调用方封顶）。
 *
 * 当前自有网关暂不下发此头 → 恒返回 null、行为不变（接口预留，网关补头后零改动生效）。
 * 无头 / 已过期（<=0）/ 非法 → null。
 */
export declare function parseRateLimitResetMs(headers: Record<string, unknown> | Headers | undefined | null, now?: number): number | null;
export declare function isNetworkRetrySignal(code?: string): boolean;
export declare function matchesModelOverloadMessage(message: string): boolean;
export declare function matchesQuotaExhaustedMessage(message: string): boolean;
export declare function isUnauthorizedFailure(input: {
    readonly name?: string;
    readonly code?: string;
    readonly message?: string;
}): boolean;
//# sourceMappingURL=failure-classifier.d.ts.map