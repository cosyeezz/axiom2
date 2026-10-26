/**
 * GalileoSessionBridge 协议半边（token + 契约类型）。
 *
 * 从实现文件分离（step-3 galileo exit 归位）：session-manager/tool-hook-manager
 * 等图内消费方引本文件——实现文件不再被图内深引，galileo 桶可整体出闭包。
 */
export declare const GalileoSessionBridge: unique symbol;
/**
 * 会话遥测快照 —— 来自 session.telemetry，必须在 reportChatRequestResponseTelemetry **之前**抓取
 * （那个方法末尾会清空 session.telemetry，之后取值会全部 undefined）。
 */
export interface SessionTelemetrySnapshot {
    modelId?: string;
    modelName?: string;
    currentTurn?: number;
    traceId?: string;
}
/** Session 的最小契约（只取 bridge 需要的字段，避免引入 session-protocol 的循环依赖） */
export interface SessionLike {
    id: string;
    conversationRequestId?: string;
    /** Renderer 透传的全链路业务关联 ID（仅 desktop 入口有；裸 CLI / IDE 为 undefined） */
    promptRequestId?: string;
    messageId?: string;
    traceId?: string;
    agentName?: string;
    agentPurpose?: string;
    meta?: Record<string, unknown>;
    telemetry?: {
        modelId?: string;
        modelName?: string;
        traceId?: string;
        currentTurn?: number;
    };
    conversationRequestRootSpan?: {
        addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
    };
    _toolSpans?: Map<string, {
        addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
    }>;
}
/** 模型响应元信息（由 session-manager 持有，传入 bridge 用于补充 finishReason） */
export interface ModelResponseLike {
    finishReason?: string;
}
export interface GalileoSessionBridge {
    /** LLM request 已发出、开始处理响应时调用 → reporter.reportRequestStart */
    emitRequestStart(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined): void;
    /** Task 级成功 → reporter.reportRequestSuccess */
    emitRequestSuccess(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, modelResponse?: ModelResponseLike): void;
    /** Task 级失败 → reporter.reportRequestError */
    emitRequestError(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown, modelResponse?: ModelResponseLike): void;
    /** Message 级失败 → reporter.reportMessageError */
    emitMessageError(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown): void;
    /**
     * Message 级成功 → reporter.reportMessageSuccess
     *
     * 与 emitRequestSuccess 不同：message 级成功上报点位于 stream 处理过程中，
     * 此时 session.telemetry 尚未被清理，可以直接读取，因此不强制要求传 snapshot。
     */
    emitMessageSuccess(session: SessionLike): void;
    /**
     * Message 级开始 → reporter.reportMessageStart
     *
     * 触发时机：LLM request 已发出、开始处理响应流之前。
     * 由 session-manager 在 resultSubject 收到结果后尽早调用，不等待首个 chunk。
     */
    emitMessageStart(session: SessionLike): void;
    /** Tool 调用开始（PreToolUse） → reporter.reportToolStart */
    emitToolStart(session: SessionLike, params: ToolEmitParams): void;
    /** Tool 调用成功（PostToolUse 且 response 非 error） → reporter.reportToolSuccess */
    emitToolSuccess(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
    }): void;
    /**
     * Skill 工具调用业务粒度日志 → `wb.skill.execute`。
     * 关联键复用 buildToolBaseEventFields（与 agent.tool.*_detail 同源），再追加
     * skill_name / outcome / duration_ms，使单次 skill 调用可归属到具体会话。
     */
    emitSkillExecute(session: SessionLike, params: {
        skillName: string;
        outcome: 'success' | 'failed';
        durationMs: number;
        callId: string;
    }): void;
    /**
     * Tool 调用失败 → reporter.reportToolError。
     * 失败来源 errorSource：'thrown'（PostToolUseFailure）/ 'response_flag'（PostToolUse + is_error）。
     */
    emitToolError(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
        errorType: string;
        errorMessage: string;
        errorSource: 'thrown' | 'response_flag';
    }): void;
    /** 把 Galileo detail 事件同步写入当前 @genie/telemetry span，便于 Trace 后台同屏查看。 */
    addRequestSuccessSpanEvent(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, modelResponse?: ModelResponseLike): void;
    addRequestErrorSpanEvent(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown, modelResponse?: ModelResponseLike): void;
    addMessageSuccessSpanEvent(session: SessionLike): void;
    addMessageErrorSpanEvent(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown): void;
    addToolStartSpanEvent(session: SessionLike, params: ToolEmitParams): void;
    addToolSuccessSpanEvent(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
    }): void;
    addToolErrorSpanEvent(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
        errorType: string;
        errorMessage: string;
        errorSource: 'thrown' | 'response_flag';
    }): void;
}
/** Tool emit 共享参数（hook 已知字段） */
export interface ToolEmitParams {
    toolName: string;
    callId: string;
    /** 仅 toolName === 'Skill' 时有意义：具体 skill 名，用于 capability_id 下钻 */
    skillId?: string;
    /**
     * connector 真实 serverShortName（来自 PostToolUse 时 tool_response._meta['workbuddy.ai/connectorServer']）。
     * 提供时把 connector capability_id 从占位 connector-proxy 升级为真实 id。
     */
    connectorServer?: string;
    /**
     * 当 toolName === 'DeferExecuteTool' 时，实际被代理的目标工具名。
     * 从 tool_input.toolName 提取，用于 Galileo 下钻区分 DeferExecuteTool 调了哪个真实工具。
     */
    targetToolName?: string;
    /** 稳定错误码（纯数字字符串，如 '1001'），值来自 ToolErrorCode 枚举 */
    toolErrorCode?: string;
    /** 稳定错误名（如 'ReadFileNotFoundError'） */
    toolErrorName?: string;
    /** 可读错误原因（如 '文件不存在'） */
    errorReason?: string;
}
