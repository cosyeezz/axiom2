export interface ErrorInfo {
    status?: number;
    code?: number;
    message?: string;
    /** 会话层是否会自动重试本次错误；未知时按会重试处理，沿用流超时文案的既有口径。 */
    isRetryable?: boolean;
}
/**
 * 后端业务错误码枚举
 *
 * Craft 限频系列 (6000-6008): Token/请求 维度的限频
 * Usage 限制系列 (14001-14018): 额度/使用量 维度的限制
 * 其他: 会话限制、搜索限频等
 */
export declare enum ServerErrorCode {
    /** 调用频率限制（通用） */
    CraftRateLimit = 6000,
    /** Token/秒 限制 */
    CraftRateTPSLimit = 6001,
    /** Token/分 限制 */
    CraftRateTPMLimit = 6002,
    /** Token/时 限制 */
    CraftRateTPHLimit = 6003,
    /** Token/天 限制 */
    CraftRateTPDLimit = 6004,
    /** 请求/秒 限制 */
    CraftRateRPSLimit = 6005,
    /** 请求/分 限制 */
    CraftRateRPMLimit = 6006,
    /** 请求/时 限制 */
    CraftRateRPHLimit = 6007,
    /** 请求/天 限制 */
    CraftRateRPDLimit = 6008,
    /** 超出使用限制（个人用户） */
    UsageLimitExceeded = 14001,
    /** 单次会话对话次数超过限制 */
    ConversationChatTooMany = 14002,
    /** 模型接口调用频率限制 */
    RateLimitError = 14003,
    /** 企业用户超出使用限制 */
    UsageLimitExceededEnterprise = 14012,
    /** 腾讯企业用户超出使用限制 */
    UsageLimitExceededTencent = 14013,
    /** 企业额度用尽 */
    UsageLimitEnterpriseExhausted = 14014,
    /** License 过期 */
    UsageLimitLicenseExpired = 14015,
    /** 企业未激活 */
    UsageLimitEnterpriseNotActivated = 14016,
    /** 用户未激活 */
    UsageLimitUserNotActivated = 14017,
    /** 用户额度用尽 */
    UsageLimitUserExhausted = 14018,
    /** 无可用 Token 额度（额度耗尽，需申请额度） */
    UsageLimitNoTokenBudget = 14019,
    /** 用户活跃会话数量超过上限 */
    ConversationLimitExceeded = 10105,
    /** 网页搜索频率限制 */
    WebSearchRateLimit = 15001,
    /**
     * 上下文过长专用码：网关明确判定「输入 token 超出模型上下文窗口」。
     * 后端已将所有上下文超限场景统一归到该码，语义单一、可直接判定为上下文超限，
     * 触发 forceCompact + truncate 自愈重试。
     */
    ContextTooLong = 11115
}
export declare const INTERRUPTED_BY_USER_MESSAGE = "Interrupted by user";
export declare namespace ErrorUtils {
    function isNodeError(error: unknown): error is NodeJS.ErrnoException;
    function getErrorMessage(error: unknown): string;
    /** Safe, bounded summary for user-visible lifecycle state. */
    function getSafeErrorSummary(error: unknown, maxLength?: number): string;
    function formatErrorMessage(error: ErrorInfo): string;
    function isNetworkError(error: unknown): boolean;
    /**
     * 检查是否为模型过载/额度耗尽类错误。
     *
     * 触发条件（满足其一）：
     * - HTTP 状态码为 429
     * - 业务错误码属于 Craft 限频系列 (6000-6008)
     * - 业务错误码属于 FALLBACK_TRIGGER_CODES（限频 + 额度耗尽）
     * - 错误文案包含 overloaded / rate limit / quota exhausted 等关键词
     */
    function isModelOverloadedError(error: unknown): boolean;
    /**
     * 检查是否为额度耗尽类错误（不建议继续在主模型上重试）。
     *
     * 典型特征：
     * - code 属于 QUOTA_EXHAUSTED_CODES
     * - 文案包含 no available credits / quota exhausted / 额度已用尽
     */
    function isQuotaExhaustedError(error: unknown): boolean;
    /**
     * 检查是否为**可退避重试**的内部限流业务码：`RateLimitError`(14003) 与 Craft **短窗口
     * （秒 / 分）**限流码 6001/6002/6005/6006。
     *
     * 内部网关把限流、额度耗尽、许可证过期、企业/用户未激活、会话数超限、Craft 各窗口限频、
     * 排队等**全部压在 HTTP 429 上**（见 services/pkg/errors/code/http_code.go 里映射到
     * StatusTooManyRequests 的二十余个码）。其中可退避重试的只有"瞬时 / 短窗口限流"这一类：
     *   - 14003 RateLimitError：模型接口调用频率限制（并发超限 / 上游供应商 429 透传）；
     *   - Craft 秒 / 分窗口 6001/6002/6005/6006：这一秒 / 这一分钟用量超了，退避（默认 8 次 ≈ 96s）
     *     能等到滑动窗口滑过去恢复（网关侧确认可重试）。
     * 其余是策略 / 配额决策或**长窗口**限流：额度耗尽、许可证 / 激活、会话数、Craft 时 / 天窗口
     * （6003/6004/6007/6008）、排队 —— 退避满配额也不会恢复，不放入白名单。新增码需同样确认
     * 语义确为瞬时 / 短窗口抖动后再放入。
     *
     * ⚠️ 这些码均与 HTTP 429 **绑定下发**（http_code.go 里 14003 与 6001-6008 全映射 429；且
     * body.code 与 HTTP status 由同一 errCode 派生，见 client/http/response.go buildErrorResponse）。
     * 调用方必须在 `status === 429` 前提下才查询本判定：非 429 却带这些码属异常下发或第三方 body 巧合。
     * ⚠️ 内部业务码，仅在自有/官方模型请求下有意义；调用方须先用 isCustomModelRequest 排除自定义
     * 第三方模型（其 body 里恰好带同码的无关错误不应被解读为限频）。见 Issue #77910。
     */
    function isTransientRateLimitBusinessCode(error: unknown): boolean;
    /**
     * 检查错误是否为 "input length too long" 类型
     * 此类错误由 ContextTruncationInterceptor 触发内联 compact 流程并自动重试
     */
    function isInputLengthError(error: unknown): boolean;
    /**
     * 判断错误是否为「上下文超限」类，可触发 ContextTruncationInterceptor 的 forceCompact +
     * truncate 自愈重试。是 isInputLengthError 的**业务码补充**：有些网关（copilot.tencent.com）
     * 对上下文超限不返回带 PTL 文案的错误，而是返回专用业务码 11115 —— 只看 message 会漏判。
     */
    function isContextOverflowError(error: unknown): boolean;
    /**
     * 从错误对象里提取「后端结构化业务码」，优先扫 data.code 路径，避免被 JSON-RPC 外层壳码
     * （如 -32603）盖掉真正的业务码。
     *
     * ⚠️ 真实错误经 SDK BadRequestError 包装后会**多层嵌套 data**（实测结构）：
     *   { status:400, error:{ code:-32603, data:{ code:-32603, data:{ code:11115, statusCode:400 } } } }
     * 真正的业务码藏在 `error.error.data.data.code`，外面几层 code 都是 -32603 壳码。
     * 因此这里**递归下钻** error / data 两条链，收集所有 code，返回第一个 >= 1000 的业务码
     * （HTTP 状态码 400 与 JSON-RPC 壳码 -32603 都被 `>= 1000` 门槛过滤掉）。
     *
     * 语义与 acp-agent.ts 的 extractStructuredErrorData + resolvedCode(>=1000) 对齐。
     */
    function extractStructuredBizCode(error: unknown, maxDepth?: number): number | undefined;
    /**
     * Check if an error is a retryable model error that InterruptionService will handle.
     * These include ModelBehaviorError (e.g., tool not found) and SyntaxError (malformed tool calls).
     */
    function isRetryableModelError(error: unknown): boolean;
    /**
     * 检查错误是否为流超时错误（Stream timeout: no data received）
     * 当模型流式响应过程中长时间（30s）无数据时触发
     * 优先使用 instanceof 检查，保留字符串匹配作为兼容降级
     */
    function isStreamTimeoutError(error: unknown): boolean;
    /**
     * 检查错误是否为首 token 超时错误
     * 首 token 超时：收到了 HTTP 原始字节但未收到模型有意义的输出（content/tool_calls/reasoning 等）
     */
    function isFirstTokenTimeoutError(error: unknown): boolean;
    /**
     * 检查错误是否为空流错误（上游网关只发占位帧后关闭连接）
     * EmptyStreamError 继承自 StreamTimeoutError，所以 isStreamTimeoutError 也会返回 true；
     * placeholder 空流会话层不再自动重试（空 200 不是网关抖动），拦截器最多切一次备站；
     * reasoning-only + finish_reason=error 仍走 1 次会话层重试（#122115）。
     *
     * 优先 instanceof，message.startsWith 兜底——跨 realm/SDK 序列化场景丢 prototype 时仍可识别，
     * 避免 acp-agent 分类时静默退化为通用 "Network error" 文案。对齐 isStreamTimeoutError 风格。
     */
    function isEmptyStreamError(error: unknown): boolean;
    /**
     * 空流里已经流出过思考、但没有正文或工具调用就 `finish_reason=error`。
     * 只认 instanceof：与 `isRetryableEmptyStreamError` 同口径，丢了 prototype 的空流本就不会被重试。
     */
    function isReasoningOnlyEmptyStreamError(error: unknown): boolean;
    /**
     * 将错误信息序列化为 JSON 字符串，用于 ACP 协议传输
     * ACP SDK 会尝试解析这个 JSON 字符串并将其放到 error.data 中
     *
     * @param error - 错误对象
     * @returns JSON 字符串，包含 details, statusCode, code 字段
     *
     * 返回格式示例：
     * - 完整信息：'{"details":"本月额度已用尽...","statusCode":429,"code":14001}'
     * - 降级（无 statusCode/code）：'{"details":"Error message"}'
     * - 降级（JSON.stringify 失败）：原始错误消息字符串
     */
    function serializeErrorForAcp(error: unknown): string;
    /**
     * 从错误对象中递归提取后端业务错误码（深度优先，从最内层往外取）。
     *
     * 兼容 OpenAI SDK APIError 的多层嵌套结构：
     * - error.code                  → 顶层（最后兜底）
     * - error.error.code            → 两层嵌套
     * - error.error.error.code      → 三层嵌套
     * - error.response.data.code    → Axios/HTTP 响应体（后端业务码通常在此）
     *
     * 仅接受数字或纯数字字符串（如 11133 或 "11133"），忽略 SDK 自身的字符串分类码
     * （如 "invalid_request_error"），避免将非业务码误作 bizCode。
     *
     * 提取自 acp-agent.ts，供 error-category / session-manager / telemetry-service 共享使用。
     *
     * @param error - 任意错误对象
     * @param maxDepth - 最大递归深度（防止循环引用，默认 4）
     */
    function extractBizCode(error: unknown, maxDepth?: number): number | undefined;
    /**
     * 对齐旧版 agent-craft errorHandler 的 messageErrorCode 映射逻辑。
     * 将原始错误对象映射为 CBC 业务错误码，与旧版数据口径一致。
     *
     * 优先级（与旧版 errorHandler 一致）：
     * 1. responseBody 为 null/空 → httpStatusCode
     * 2. 5xx → responseBody 中的业务码
     * 3. 429 → responseBody 中的限流业务码（14001/14002/6020 等）
     * 4. 4xx（排除 10008 特殊错误）→ responseBody 中的业务码
     * 5. 流错误（其他插件导致）→ 3006
     * 6. 网络连接错误 → 3002
     * 7. 超时错误 → 3003
     * 8. 未授权错误 → 3004
     * 9. 兜底 → 原始 error.code || error.name || 'unknown_error'
     */
    function mapMessageErrorCode(error: unknown): string;
}
//# sourceMappingURL=error-utils.d.ts.map