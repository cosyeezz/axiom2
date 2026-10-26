/**
 * GalileoChatReporter — 伽利略 Chat 事件上报模块
 *
 * 负责将 chat_request_response / chat_message_status 两个核心事件上报到伽利略可观测平台，
 * 覆盖 task 级（一次完整请求-响应）和 message 级（单条消息）两种粒度，每种粒度上报成功/失败两路。
 *
 * 上报策略（设计要点）：
 * - **统一走 Log 视图**：error 路径发 logError，success 路径发 logInfo，**完全不发 Counter**
 *   - 错误率分子：count(agent.{request,message}.error_detail)
 *   - 错误率分母：count(error_detail) + count(success_detail)
 *   - Counter 装不下 trace_id / agent_name / current_turn 等下钻字段，Log 视图原生支持按字段聚合
 * - **未维护业务码报警**：当 ctx.unknownBizCode 非空时额外发一条独立 logError
 *   `agent.error.unknown_biz_code`，与主错误日志解耦便于后台单独配告警规则
 *
 * 与 AgentMetricsAggregator 的关系：
 * - aggregator 的 agent.request.{total,success,failed} 是 **HTTP message 级**、空维度的 Counter，
 *   覆盖面只有 model-provider 的 stream end/error（不含 401/429/网关 5xx，因为那些被
 *   error-analyzer 转成了"成功的 Response"），仅作全局可用性视角
 * - 本模块的 agent.{request,message}.{error,success}_detail 是 **task / message 级**、含完整下钻字段的日志流，
 *   覆盖所有完成事件，是 SLA 看板的主数据源
 *
 * 反污染守卫：
 * - user_cancelled 不上报（无论 error 还是 success），避免污染错误率指标
 *   这些场景由 Telemetry → ClickHouse 通道单独保留（用于 cancellation 行为分析）
 * - GalileoService 未就绪时全链路降级为 noop
 */
import { type ModelCallAgentType } from '../../vendor/cbc-core/node/index.js';
import type { ErrorSubcategory } from './error-category';
export declare const GalileoChatReporter: unique symbol;
/**
 * 请求级错误上下文（chat_request_response 失败时）。
 * 字段对应 design.md 第 3.2 节定义。
 */
export interface RequestErrorContext {
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    traceId: string;
    messageId?: string;
    /** 用户 uid（按用户聚合/下钻维度，伽利略 log 标准识别字段；未登录或上游未透传时为空） */
    uid?: string;
    errorCategory: string;
    errorSubcategory: ErrorSubcategory;
    errorCode: string;
    /**
     * 走业务码路径但 BIZ_CODE_MAP / BIZ_CODE_RANGES 都没命中时的原始码。
     * 设置时表示后端可能新增了我们尚未维护的业务码，需要在伽利略后台告警提示。
     */
    unknownBizCode?: string;
    errorMessage: string;
    acpErrorCode?: number;
    httpStatusCode?: number;
    nodeErrorCode?: string;
    isFirstTokenTimeout?: boolean;
    isEmptyStream?: boolean;
    isInputLengthError?: boolean;
    isRetryable?: boolean;
    finishReason?: string;
    model: string;
    modelName?: string;
    scene: string;
    agentName?: string;
    agentType?: string;
    currentTurn?: number;
    isCustomModel?: boolean;
    /**
     * 本轮 `wb.api.request` 实际上报的 host（容灾后的最终域名）。
     * 没有对应 API 样本时为空，不拿别的请求的域名顶上。
     */
    host?: string;
    /**
     * 最后一跳钉住的 IP。未钉为空。钉 IP 不改写 host，域名仍是 URL 上的主机名。
     */
    pin?: string;
}
/**
 * 消息级错误上下文（chat_message_status 失败时）。
 * 比 RequestErrorContext 字段少（无 acpErrorCode / 特征标记 / 上下文维度），
 * 因为 message 级量大，需要更精简。
 */
export interface MessageErrorContext {
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    messageId: string;
    traceId: string;
    /** 用户 uid（按用户聚合/下钻维度，伽利略 log 标准识别字段；未登录或上游未透传时为空） */
    uid?: string;
    errorCode: string;
    errorCategory: string;
    errorSubcategory: ErrorSubcategory;
    /** 同 RequestErrorContext.unknownBizCode：未维护的业务码报警标记。 */
    unknownBizCode?: string;
    errorMessage: string;
    nodeErrorCode?: string;
    httpStatusCode?: number;
    model: string;
    currentTurn?: number;
}
/**
 * 请求级成功上下文（chat_request_response isSuccessful=true 时）。
 *
 * 字段集与 RequestErrorContext 共享下钻必需信息（trace_id / messageId / agentName / currentTurn 等），
 * 但去掉了 error_* 系列字段（成功路径无错误信息）。
 */
export interface RequestSuccessContext {
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    traceId: string;
    messageId?: string;
    /** 用户 uid（按用户聚合/下钻维度，伽利略 log 标准识别字段；未登录或上游未透传时为空） */
    uid?: string;
    model: string;
    modelName?: string;
    scene: string;
    agentName?: string;
    agentType?: string;
    currentTurn?: number;
    isCustomModel?: boolean;
    finishReason?: string;
    /**
     * 本轮 `wb.api.request` 实际上报的 host（容灾后的最终域名）。
     * 没有对应 API 样本时为空，不拿别的请求的域名顶上。
     */
    host?: string;
    /**
     * 最后一跳钉住的 IP。未钉为空。钉 IP 不改写 host，域名仍是 URL 上的主机名。
     */
    pin?: string;
}
export type RequestStartContext = Omit<RequestSuccessContext, 'finishReason'>;
/**
 * 消息级成功上下文（chat_message_status messageErrorCode='0' 时）。
 *
 * 比 RequestSuccessContext 字段少，对齐 MessageErrorContext 的精简风格。
 */
export interface MessageSuccessContext {
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    messageId: string;
    traceId: string;
    /** 用户 uid（按用户聚合/下钻维度，伽利略 log 标准识别字段；未登录或上游未透传时为空） */
    uid?: string;
    model: string;
    currentTurn?: number;
}
/**
 * 消息级开始上下文（首个 assistant 内容 chunk 到达时）。
 *
 * 字段集与 MessageSuccessContext 对齐，便于同一次 message 横向 join。
 */
export interface MessageStartContext {
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    messageId: string;
    traceId: string;
    /** 用户 uid（按用户聚合/下钻维度，伽利略 log 标准识别字段；未登录或上游未透传时为空） */
    uid?: string;
    model: string;
    currentTurn?: number;
}
/** Tool 调用「开始」— PreToolUse 时上报，仅定位信息。 */
export interface ToolStartContext {
    /** 关联 ID（与 request/message 级一致，便于 Log 视图横向 join） */
    conversationId: string;
    conversationRequestId: string;
    promptRequestId?: string;
    messageId?: string;
    traceId: string;
    uid?: string;
    toolName: string;
    /** 来自 ACP toolCall.callId */
    callId: string;
    /** 当 toolName 为 DeferExecuteTool 时，实际被代理的目标工具名 */
    targetToolName?: string;
    /** 能力类型归一（builtin/mcp/plugin/connector/skill）；用于会话能力归因聚合 */
    capabilityType?: string;
    /** 能力实例标识（mcp/connector→server，plugin→pluginName，skill→skill名，builtin→工具名） */
    capabilityId?: string;
    /** expert 会话标识；非 expert 会话为空 */
    expertId?: string;
    model?: string;
    modelName?: string;
    scene?: string;
    agentName?: string;
    agentType?: ModelCallAgentType;
    currentTurn?: number;
}
/** Tool 调用「成功」— PostToolUse 且非 error 时上报；不带 input/output（量大且含敏感数据）。 */
export interface ToolSuccessContext extends ToolStartContext {
    /** 工具执行耗时（ms） */
    durationMs: number;
    /** 当 toolName 为 DeferExecuteTool 时，实际被代理的目标工具名 */
    targetToolName?: string;
}
/**
 * Tool 调用「失败」— PostToolUseFailure（thrown）或 PostToolUse + is_error（response_flag）。
 * 用户主动取消（is_interrupt）由调用方过滤。
 */
export interface ToolErrorContext extends ToolStartContext {
    durationMs: number;
    /** 错误大类（如 EXECUTION_ERROR / TIMEOUT / VALIDATION_ERROR；缺失 fallback 'UNKNOWN'） */
    errorType: string;
    /** 错误信息原文（截断至 500 字符） */
    errorMessage: string;
    errorSource: 'thrown' | 'response_flag';
    /** 当 toolName 为 DeferExecuteTool 时，实际被代理的目标工具名 */
    targetToolName?: string;
    /** 稳定消息 ID，用于从聚合表下钻到具体失败样本 */
    conversationMessageId?: string;
    /** 稳定错误码（纯数字字符串，如 '1001'），值来自 ToolErrorCode 枚举；缺失时兜底 '99999' */
    toolErrorCode?: string;
    /** 稳定错误名（如 'ReadFileNotFoundError'），由错误码反查枚举名得到 */
    toolErrorName?: string;
    /** 可读错误原因（如 '文件不存在'） */
    errorReason?: string;
}
export interface GalileoChatReporter {
    /** chat_request_response 已发出、开始处理响应时调用 — Task 级开始日志（仅 logInfo）。 */
    reportRequestStart(context: RequestStartContext): void;
    /** chat_request_response 失败时调用 — Task 级错误上报（logError + addCounter）*/
    reportRequestError(context: RequestErrorContext): void;
    /** chat_message_status 失败时调用 — Message 级错误上报（logError + addCounter）*/
    reportMessageError(context: MessageErrorContext): void;
    /**
     * chat_request_response isSuccessful=true 时调用 — Task 级成功日志（仅 logInfo）。
     * 不再发 Counter，错误率分母通过日志聚合 success_detail 条数得到。
     */
    reportRequestSuccess(context: RequestSuccessContext): void;
    /**
     * chat_message_status messageErrorCode='0' 时调用 — Message 级成功日志（仅 logInfo）。
     * 不再发 Counter，错误率分母通过日志聚合 success_detail 条数得到。
     */
    reportMessageSuccess(context: MessageSuccessContext): void;
    /**
     * 首个 assistant 内容 chunk 到达时调用 — Message 级开始日志（仅 logInfo）。
     * 与 success_detail 共享字段，用于定位 message 生命周期起点。
     */
    reportMessageStart(context: MessageStartContext): void;
    /** Tool 调用开始（PreToolUse） — Tool 级开始日志（logInfo）。 */
    reportToolStart(context: ToolStartContext): void;
    /** Tool 调用成功（PostToolUse 且 tool_response 不是 error） — logInfo。 */
    reportToolSuccess(context: ToolSuccessContext): void;
    /** Tool 调用失败（PostToolUseFailure 或 PostToolUse 且 response.is_error） — logError。 */
    reportToolError(context: ToolErrorContext): void;
}
export declare class GalileoChatReporterImpl implements GalileoChatReporter {
    private readonly galileo;
    /**
     * 用户主动取消不属于"错误"，不上报到伽利略以避免污染错误率指标。
     * 这些场景由 Telemetry → ClickHouse 通道单独保留（用于 cancellation 行为分析）。
     */
    private isCancellation;
    reportRequestError(ctx: RequestErrorContext): void;
    reportMessageError(ctx: MessageErrorContext): void;
    /**
     * 上报未维护业务码的告警事件。
     *
     * 通过独立的 logError 事件单独透出，与主错误日志解耦：
     * - 主错误日志（agent.{request,message}.error_detail）仍含 unknown_biz_code 字段供下钻搜索
     * - 此独立事件 agent.error.unknown_biz_code 用于精确告警，避免和正常错误日志混在一起
     *
     * 后台告警规则建议：
     *   count(agent.error.unknown_biz_code) by biz_code > 0 over 1h
     * 命中即提示研发补充 BIZ_CODE_MAP 维护表。
     */
    private reportUnknownBizCode;
    /**
     * Task 级开始日志（仅 logInfo，不发 Counter）。
     *
     * 在 LLM request 已发出、开始处理响应时上报，与 request.success_detail 共享字段，
     * 用于定位 request 生命周期起点。
     */
    reportRequestStart(ctx: RequestStartContext): void;
    /**
     * Task 级成功日志（仅 logInfo，不发 Counter）。
     *
     * 错误率分母通过 Log 视图聚合：
     *   error_rate = count(agent.request.error_detail) / (count(agent.request.error_detail) + count(agent.request.success_detail))
     */
    reportRequestSuccess(ctx: RequestSuccessContext): void;
    /**
     * Message 级成功日志（仅 logInfo，不发 Counter）。
     */
    reportMessageSuccess(ctx: MessageSuccessContext): void;
    /**
     * Message 级开始日志（仅 logInfo，不发 Counter）。
     */
    reportMessageStart(ctx: MessageStartContext): void;
    /** Tool 调用开始（PreToolUse） — logInfo。 */
    reportToolStart(ctx: ToolStartContext): void;
    /** Tool 调用成功（PostToolUse 且 tool_response 不是 error） — logInfo。 */
    reportToolSuccess(ctx: ToolSuccessContext): void;
    /**
     * Tool 调用失败（PostToolUseFailure，或 PostToolUse + is_error=true） — logError。
     * 用户主动取消（Abort）由调用方过滤。
     */
    reportToolError(ctx: ToolErrorContext): void;
}
