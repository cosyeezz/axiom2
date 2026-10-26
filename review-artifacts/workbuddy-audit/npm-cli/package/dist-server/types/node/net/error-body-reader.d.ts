import { type RetryPolicyDecision } from '../../vendor/cbc-shared/node/index.js';
/** 读错误体的兜底超时，与请求级重试原先的 drain 超时同值。 */
export declare const ERROR_BODY_READ_TIMEOUT_MS = 5000;
/** 错误体通常几百字节；超过上限视为上游异常，不再继续读。 */
export declare const ERROR_BODY_MAX_BYTES: number;
/**
 * - `parsed`：读到并解析出可用的 `retry_policy`
 * - `absent`：读到了，但没有该字段、形态不合法或不是 JSON
 * - `unreadable`：读取超时、超过体积上限、流出错或提前关闭
 * - `cancelled`：读取期间请求被取消
 *
 * `unreadable` 按 `absent` 回落旧逻辑（fail-open），两者分开只为指标能区分上游异常。
 */
export type ErrorBodyReadState = 'parsed' | 'absent' | 'unreadable' | 'cancelled';
export interface ErrorBodyReadResult {
    state: ErrorBodyReadState;
    policy: RetryPolicyDecision;
    /**
     * `retry_policy.retry_after` 换算成的最早重试时刻（epoch ms）。读到错误体时就固定下来，
     * 后面复用缓存结果也不会把等待重新算长。字段缺失或非法时不出现。
     */
    retryAfterAt?: number;
}
export interface ErrorBodyReadOptions {
    timeoutMs?: number;
    maxBytes?: number;
}
/**
 * 读取非 2xx 响应的错误体并裁决 `retry_policy`，同一个响应只读一次。
 *
 * 备站重放（响应拦截器）与请求级重试（模型层）都要在决定重发前看策略，而错误体是只能
 * 消费一次的流。结果按 response 对象缓存，后到的入口直接复用；读完的文本写回
 * `error.response.data`，原有按字符串解析业务码的逻辑不受影响。
 */
export declare function readErrorBodyOnce(error: unknown, signal?: AbortSignal, options?: ErrorBodyReadOptions): Promise<ErrorBodyReadResult>;
