import type { ToolCallLoopEventKind, ToolCallLoopEvidence } from '../../vendor/cbc-core/node/index.js';
import { ModelCallGeneration, ModelResponseMetadata, Session } from '../../vendor/cbc-core/node/index.js';
import { RunResult, StreamedRunResult } from '../../vendor/cbc-shared/node/index.js';
import { ChatMessageSendTelemetry } from '@genie/telemetry/lib/common/event/types/craft';
export declare const TelemetryService: unique symbol;
export type UserTaskFailedCreditRefundReason = 'loop_detected' | 'abnormal_finish_reason';
export interface TelemetryService {
    /**
     * 记录当前 rootRequestId 下出现过的 conversationRequestId，用于失败退费逐条上报。
     */
    recordCreditRefundConversationRequest(session: Session): void;
    /**
     * 记录当前 conversationRequestId 的模型 finish_reason，用于过滤未进入 Tool Calls 的请求。
     */
    recordCreditRefundConversationRequestEnd(session: Session, finishReason: string | undefined): void;
    /**
     * 标记当前 conversationRequestId 不参与退费上报。
     */
    suppressCreditRefundConversationRequest(session: Session): void;
    /**
     * 上报用户任务失败退费检测事件；触发后消费当前 rootRequestId 的累积 request 列表。
     */
    reportUserTaskFailedCreditRefund(session: Session, reason: UserTaskFailedCreditRefundReason): Promise<void>;
    /**
     * 上报工具调用循环观测事件：弹窗展示（suspected）、用户继续（continue）、
     * 弹不出窗的自动继续（auto_continue）、用户停止（detected）。
     * 只做观测，不影响退费；退费仍走 reportUserTaskFailedCreditRefund。
     */
    reportToolCallLoopEvent(kind: ToolCallLoopEventKind, session: Session, evidence: ToolCallLoopEvidence): Promise<void>;
    /**
     * 创建并发送消息发送埋点
     * @param headers 请求头
     * @param body 请求体
     * @param isStream 是否为流式请求
     * @param session Session the model call belongs to; defaults to the current one
     * @returns 发送埋点数据
     */
    reportMessageSendTelemetry(headers: Record<string, string>, body: any, isStream: boolean, session?: Session): ChatMessageSendTelemetry & {
        sendTime: number;
        isStream: boolean;
    };
    /**
     * 发送非流式消息响应埋点
     * @param session 会话对象
     * @param sendTelemetry 发送埋点数据
     * @param axiosResponse 响应对象（用于从 data.usage 提取 token）
     * @param isSuccessful 是否成功
     * @param error 错误信息（可选）
     */
    reportMessageResponseTelemetryNonStream(session: Session, sendTelemetry: ChatMessageSendTelemetry & {
        sendTime: number;
        isStream: boolean;
    }, axiosResponse: any, isSuccessful: boolean, error?: any): Promise<void>;
    /**
     * 发送聊天请求埋点
     * @param session 会话对象
     */
    reportChatRequestSendTelemetry(session: Session): Promise<void>;
    /**
     * 上报等待模型 X-Request-ID 的增长埋点。
     * @param session 会话对象
     * @param requestId 实际 /v2/chat/completions 请求头 X-Request-ID
     */
    flushPendingGrowthTelemetry(session: Session, requestId: string): Promise<void>;
    /**
     * 发送请求响应埋点
     * @param session 会话对象
     * @param result 运行结果
     * @param isSuccessful 是否成功
     * @param error 错误信息（可选）
     * @param modelResponseMetadata 模型响应元数据（可选）
     */
    reportChatRequestResponseTelemetry(session: Session, result?: RunResult<any, any> | StreamedRunResult<any, any> | undefined, isSuccessful?: boolean, error?: any, modelResponseMetadata?: ModelResponseMetadata): Promise<void>;
    /**
     * 上报流式请求的消息响应埋点
     * @param session 会话对象
     */
    reportMessageResponseTelemetryStream(session: Session, usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        requests?: number | undefined;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
    }, modelResponseMetadata?: ModelResponseMetadata, error?: any): Promise<void>;
    /**
     * 上报模型工具调用埋点
     * @param session 会话对象
     * @param functionCallResultItem 工具调用结果项
     */
    reportModelToolCall(session: Session, functionCallResultItem: any): Promise<void>;
    /**
     * 上报手动工具调用埋点
     * @param session 会话对象
     * @param toolCallItem 工具调用项
     * @param toolCallSuccessful 调用是否成功
     * @param toolStatus 工具状态
     * @param toolErrorCode 错误代码
     */
    reportManualToolCall(session: Session, toolCallItem: any, toolCallSuccessful: boolean, toolStatus: string, toolErrorCode: unknown): Promise<void>;
    /**
     * 上报聊天文件操作埋点
     * @param session 会话对象
     * @param fileActionData 文件操作数据
     */
    reportChatFileAction(session: Session, fileActionData: {
        languageId: string;
        isNewFile: boolean;
        addLineCount: number;
        removedLines: number;
        addCharCount: number;
        deleteCharCount: number;
    }): Promise<void>;
    /**
     * 上报消息状态埋点（成功或失败）
     * @param session 会话对象
     * @param messageErrorCode 错误代码，成功时为 '0'
     * @param generation 该状态所属的那次模型调用，与同一调用的 chat_message_send / response 同 id
     */
    reportChatMessageStatus(session: Session, messageErrorCode: string, generation: ModelCallGeneration, error?: unknown): Promise<void>;
    /**
     * 上报达到最大 Token 限制埋点
     * @param session 会话对象
     * @param responseModelId 响应模型 ID（可选）
     */
    reportChatMaxTokenReached(session: Session, responseModelId?: string): Promise<void>;
    /**
     * 上报代码编辑统计埋点
     * @param languageId 语言 ID
     * @param fileCount 变更文件数
     * @param lineCount 变更行数
     * @param characterCount 变更字符数
     * @param traceId 关联 trace（仅在有 session 上下文时透传）
     * @param session 发起本次请求的 session，用于按客户端来源端归属公共字段
     */
    reportCodeEdit(languageId: string, fileCount: number, lineCount: number, characterCount: number, traceId?: string, session?: Session): Promise<void>;
}
