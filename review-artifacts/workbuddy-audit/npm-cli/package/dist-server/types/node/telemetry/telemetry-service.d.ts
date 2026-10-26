import { AuthenticationManager } from '@genie/authentication';
import { ModelCallGeneration, ModelResponseMetadata, Session, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type ToolCallLoopEventKind, type ToolCallLoopEvidence } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, type FunctionCallResultItem, RunResult, StreamedRunResult } from '../../vendor/cbc-shared/node/index.js';
import { ClientInfoProvider, ProductManager } from '@genie/product';
import { Workspace } from '@genie/runtime';
import { EventService, Logger } from '@genie/telemetry';
import { ChatMessageSendTelemetry } from '@genie/telemetry/lib/common/event/types/craft';
import { AgentMetricsAggregator } from '../galileo/agent-metrics-aggregator';
import { CostService } from './cost-protocol';
import { FrictionAnalysisService } from './friction-analysis';
import { TelemetryService, type UserTaskFailedCreditRefundReason } from './telemetry-protocol';
export declare class TelemetryServiceImpl implements TelemetryService {
    protected readonly productManager: ProductManager;
    protected readonly eventService: EventService;
    protected readonly modelEventService: EventService;
    protected readonly logger: Logger;
    protected readonly costService: CostService;
    protected readonly metricsAggregator: AgentMetricsAggregator | undefined;
    private readonly creditRefundTelemetry;
    protected readonly workspace: Workspace;
    protected readonly clientInfoProvider: ClientInfoProvider;
    protected readonly authenticationManager: AuthenticationManager;
    protected readonly frictionAnalysisService: FrictionAnalysisService;
    protected readonly sessionManager: SessionManager;
    private safeJSONParse;
    private getSessionMode;
    /** 获取 ACP 入口采纳的专家 ID；专家使用场景下 mode 仍可能是 craft。 */
    private getSessionExpertId;
    /**
     * chat_message_send/response cover exactly the agent-loop model calls of the
     * current async chain (see `isMainLoopModelCall`), so each reported message
     * owns one `totalStepCount` and the sequence has no gaps. Auxiliary calls
     * (title, summaries, WebFetch analysis, ...) are not reported.
     */
    private shouldReportMessageTelemetry;
    private isRecord;
    recordCreditRefundConversationRequest(session: Session): void;
    recordCreditRefundConversationRequestEnd(session: Session, finishReason: string | undefined): void;
    suppressCreditRefundConversationRequest(session: Session): void;
    reportUserTaskFailedCreditRefund(session: Session, reason: UserTaskFailedCreditRefundReason): Promise<void>;
    reportToolCallLoopEvent(kind: ToolCallLoopEventKind, session: Session, evidence: ToolCallLoopEvidence): Promise<void>;
    private clearCreditRefundAccumulatorForRoot;
    private parseGrowthEvents;
    private appendGrowthEvent;
    private queuePendingGrowthTelemetry;
    flushPendingGrowthTelemetry(session: Session, requestId: string): Promise<void>;
    reportChatRequestSendTelemetry(session: Session): Promise<void>;
    reportChatRequestResponseTelemetry(session: Session, result: RunResult<any, any> | StreamedRunResult<any, any> | undefined, isSuccessful: boolean, error?: any, modelResponseMetadata?: ModelResponseMetadata): Promise<void>;
    /**
     * 获取敏感词过滤的原因类型
     * 用于区分 SAAS 安全和模型安全
     * @param finishReason 完成原因
     * @returns 'model_safety' 表示模型安全，undefined 表示非敏感词过滤
     */
    private getContentFilterReason;
    reportMessageSendTelemetry(headers: Record<string, string>, body: any, isStream: boolean, callSession?: Session): ChatMessageSendTelemetry & {
        sendTime: number;
        isStream: boolean;
    };
    reportMessageResponseTelemetryNonStream(session: Session, sendTelemetry: ChatMessageSendTelemetry & {
        sendTime: number;
        isStream: boolean;
    }, axiosResponse: any, isSuccessful: boolean, error?: any): Promise<void>;
    /**
     * 根据 modelId 从产品配置查找模型定义。找不到返回 undefined。
     * 兼容自定义本地模型前缀（custom-local:）与 aliases。
     */
    private getModelConfig;
    /** 产品形态映射到上报口径：saas / hosted / exclusive。 */
    private mapProductConfigType;
    /**
     * 自定义模型调用埋点（custom_model_usage → /llm/data/report）。
     * 仅当判定为自定义模型时上报，非自定义模型直接跳过。仅覆盖 chat/craft 主链路。
     *
     * billing / creditUsage / creditVersion / viaCopilotServer 自定义模型场景不涉及，不传。
     */
    private reportCustomModelUsage;
    reportMessageResponseTelemetryStream(session: Session, usage?: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        requests?: number | undefined;
        inputTokensDetails?: Record<string, number> | undefined;
        outputTokensDetails?: Record<string, number> | undefined;
    }, modelResponseMetadata?: ModelResponseMetadata, error?: any): Promise<void>;
    /** Reject unknown fields, redact sensitive metadata, then check final JSON bytes. */
    private getTelemetryToolArgs;
    reportModelToolCall(session: Session, rawItem: FunctionCallResultItem): Promise<void>;
    /**
     * 上报 Skill 工具调用的 skill_info 事件（仅 WorkBuddy Desktop 宿主）。
     *
     * skillName 通过 callId 反向查找同会话的 function_call item，从其 arguments 中解析。
     * fileCount 使用 product.json 里加载的 skills 总数作为近似值。
     */
    private reportSkillInfo;
    /**
     * 从 session.history 中找到与 rawItem.callId 对应的 function_call 条目，解析 arguments 得到 skillName。
     */
    private extractSkillName;
    reportManualToolCall(session: Session, toolCallItem: FunctionCallItem, toolCallSuccessful: boolean, toolStatus: string, toolErrorCode: unknown): Promise<void>;
    reportChatFileAction(session: Session, fileActionData: {
        languageId: string;
        isNewFile: boolean;
        addLineCount: number;
        removedLines: number;
        addCharCount: number;
        deleteCharCount: number;
    }): Promise<void>;
    reportChatMessageStatus(session: Session, messageErrorCode: string, generation: ModelCallGeneration, error?: unknown): Promise<void>;
    reportChatMaxTokenReached(session: Session, responseModelId?: string): Promise<void>;
    reportCodeEdit(languageId: string, fileCount: number, lineCount: number, characterCount: number, traceId?: string, session?: Session): Promise<void>;
}
