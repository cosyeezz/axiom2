/**
 * Error Category - 错误三层分类模块
 *
 * 提供 chat_request_response / chat_message_status 事件错误的细分分类能力，
 * 用于伽利略可观测平台的多维度下钻和 ClickHouse 错误统计。
 *
 * 三层分类体系：
 * - Level 1 `category` (6 类)：network / quota / model_service / auth / cancelled / internal
 * - Level 2 `subcategory` (19 类)：详见 ErrorSubcategory
 * - Level 3 `errorCode`：具体业务错误码（6001/14014/...）或 HTTP 状态码
 *
 * 维护方式：
 * - 业务错误码（serverErrorCode）通过 BIZ_CODE_MAP / BIZ_CODE_RANGES 集中维护，
 *   一目了然，扩展时只动这两张表，避免散落在 if/else 链里
 * - 网络层 / 模型层 / 认证 / 文案 fallback 仍由 instanceof / 关键词判断（不能用 map 表达）
 *
 * 未知错误码报警：
 * - 当走到"业务码精确匹配"分支但 map 没命中时，分类结果会带上 `unknownBizCode` 字段
 *   GalileoChatReporter 据此向伽利略上报 unknown_biz_code 事件，后台可配置告警规则
 */
/**
 * 错误二级细分分类（19 子类）。
 *
 * 与 packages/agent-cli/src/node/utils/error-utils.ts 中的辅助函数对齐：
 * - isEmptyStreamError → network_empty_stream
 * - isFirstTokenTimeoutError → network_first_token_timeout
 * - isStreamTimeoutError → network_timeout
 * - isNetworkError → network_reset
 * - isInputLengthError → model_input_too_long
 * - isRetryableModelError → model_behavior_error / model_parse_error
 * - isModelOverloadedError / isQuotaExhaustedError → quota_*
 */
export type ErrorSubcategory = 'network_timeout' | 'network_first_token_timeout' | 'network_reset' | 'network_dns' | 'network_server_error' | 'network_empty_stream' | 'quota_token_limit' | 'quota_request_limit' | 'quota_balance_exhausted' | 'quota_active_session' | 'quota_web_search' | 'quota_not_activated' | 'model_safety' | 'model_parse_error' | 'model_behavior_error' | 'model_input_too_long' | 'auth_expired' | 'auth_forbidden' | 'user_cancelled' | 'internal_unknown';
export type ErrorCategory = 'network' | 'quota' | 'model_service' | 'auth' | 'cancelled' | 'internal';
export interface ErrorClassification {
    /** 一级分类 */
    category: ErrorCategory;
    /** 二级细分 */
    subcategory: ErrorSubcategory;
    /**
     * 走业务码路径但 map 没命中时的原始码（仅在该场景设置）。
     *
     * 含义：服务端可能发布了新的错误码而我们没有在 BIZ_CODE_MAP / BIZ_CODE_RANGES 维护到，
     * 需要补充。GalileoChatReporter 据此上报 unknown_biz_code 事件供后台告警。
     */
    unknownBizCode?: string;
}
/**
 * 错误细分分类函数。
 *
 * 优先级规则（自上而下，命中即返回）：
 * 1. 用户主动取消（排除噪声）
 * 2. 网络层（instanceof EmptyStreamError → StreamTimeoutError → errno → statusCode）
 * 3. 业务码（查 BIZ_CODE_MAP / BIZ_CODE_RANGES，未命中走兜底并标记 unknownBizCode）
 * 4. HTTP 429（无业务码时归 quota_balance_exhausted）
 * 5. 模型服务（isInputLengthError → instanceof → 文案）
 * 6. 认证 statusCode 401/403
 * 7. 限额文案 fallback
 * 8. 兜底 internal_unknown
 *
 * @param error - 错误对象（可能是 Error 实例、对象、字符串）
 * @param statusCode - HTTP 状态码（如可获取）
 * @param serverErrorCode - 后端业务错误码（推荐传入 ErrorUtils.extractBizCode 的结果）
 */
export declare function classifyErrorDetail(error: unknown, statusCode?: number, serverErrorCode?: string | number): ErrorClassification;
