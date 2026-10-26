/**
 * 模型网关在 HTTP 错误体里下发的重试指示，与 `code` / `msg` / `displayMsg` 同层：
 *
 * ```json
 * { "code": 11101, "msg": "...", "retry_policy": { "retry": false, "retry_after": 3 }, "displayMsg": { ... } }
 * ```
 *
 * - `force-retry`：策略是普通对象且 `retry` 不是 `false` / `"false"`（含 `true`、缺 `retry` 键、其他类型）。
 *   只在本地已判定可重试的范围内按网关策略重试，不扩大可重试状态码。
 * - `forbid-retry`：策略是普通对象且 `retry` 为 `false` 或 `"false"`。不重试、不换模型、不重放备站、
 *   不做鉴权刷新重试。
 * - `unset`：字段缺失、`null`、数组或其他非对象形态，完全按原有逻辑处理。
 *
 * 只有明确表达「否」才阻断：网关形态小改动时宁可多试一次，也不要静默丧失恢复能力。
 */
export type RetryPolicyDecision = 'force-retry' | 'forbid-retry' | 'unset';
export declare const RETRY_POLICY_FIELD = "retry_policy";
export declare const RETRY_POLICY_RETRY_AFTER_FIELD = "retry_after";
/**
 * 按固定层级找 `retry_policy` 原值，返回第一个存在的值（可能是非法形态，由调用方裁决）。
 *
 * 同一份策略会以三种形态出现：网关原始错误体（顶层或 `data` / `error.data`）、错误分析器
 * 规范化后的 `{ error: { code, message, data } }`、SDK 包装后的 APIError（`error.data`，
 * 外层再包一层时为 `error.error.data`）。层级写死、不递归，避免在任意嵌套里误捡字段。
 */
export declare function findRetryPolicy(source: unknown): unknown;
export declare function decideRetryPolicy(policy: unknown): RetryPolicyDecision;
export declare function resolveRetryPolicy(source: unknown): RetryPolicyDecision;
/**
 * 解析 `Retry-After` 形态的等待值为毫秒：非负秒数（数字或数字字符串，允许小数）或 HTTP-date。
 *
 * 0、已过去的日期与非法值返回 `null`，由调用方回退本地退避。服务端给出的等待不在这里封顶。
 */
export declare function parseRetryAfterValueMs(raw: unknown, now?: number): number | null;
/** 读取 `retry_policy.retry_after`（秒或 HTTP-date）。策略不是普通对象或值非法时返回 `null`。 */
export declare function parseRetryPolicyRetryAfterMs(policy: unknown, now?: number): number | null;
//# sourceMappingURL=retry-policy.d.ts.map