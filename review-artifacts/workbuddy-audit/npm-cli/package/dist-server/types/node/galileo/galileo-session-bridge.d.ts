/**
 * GalileoSessionBridge — Session ↔ GalileoChatReporter 桥接层
 *
 * 职责：把 session-manager 中"从 Session/error 提取字段 → 构造 reporter Context → 调用 reporter →
 * try/catch 兜住异常"的样板代码集中维护，让 session-manager 的业务流程保持清爽。
 *
 * 设计原则：
 * - 只承接「字段构造 + try/catch 守护」，**不承接 trigger 判断**（isSuccessful 分支等）—— 调用时机仍由
 *   session-manager 决定，确保架构上 session 状态机的可读性
 * - 不持有任何 session 状态：每次方法调用都接收完整上下文（session + telemetrySnapshot + error 等）
 * - 所有异常都被 try/catch 吞下，仅 logger.warn 一行，**绝不向上抛**：伽利略上报失败不能影响业务流程
 * - 与 P2-5 时机约束兼容：调用方仍负责在 telemetry 被清理之前快照 session.telemetry，并把快照传进来
 */
import { AuthenticationManager } from '@genie/authentication';
import { Logger } from '@genie/telemetry';
import { GalileoSessionBridge, type ModelResponseLike, type SessionLike, type SessionTelemetrySnapshot, type ToolEmitParams } from './galileo-session-bridge-protocol';
export declare class GalileoSessionBridgeImpl implements GalileoSessionBridge {
    private readonly reporter;
    protected readonly logger: Logger;
    protected readonly auth: AuthenticationManager;
    private readonly galileo;
    private readonly mcpPluginRegistry;
    emitRequestStart(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined): void;
    emitRequestSuccess(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, modelResponse?: ModelResponseLike): void;
    emitRequestError(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown, modelResponse?: ModelResponseLike): void;
    emitMessageError(session: SessionLike, snapshot: SessionTelemetrySnapshot | undefined, error: unknown): void;
    emitMessageSuccess(session: SessionLike): void;
    emitMessageStart(session: SessionLike): void;
    emitToolStart(session: SessionLike, params: ToolEmitParams): void;
    emitToolSuccess(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
    }): void;
    emitSkillExecute(session: SessionLike, params: {
        skillName: string;
        outcome: 'success' | 'failed';
        durationMs: number;
        callId: string;
    }): void;
    emitToolError(session: SessionLike, params: ToolEmitParams & {
        durationMs: number;
        errorType: string;
        errorMessage: string;
        errorSource: 'thrown' | 'response_flag';
    }): void;
    /**
     * session.messageId 为空时的降级拼接，保证 conversation_message_id 非空可下钻。
     * 格式：{conversation_request_id}_{tool_name}_{call_id}
     */
    private buildFallbackMessageId;
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
    /**
     * 从 session + tool params 构造 ToolStartContext 共享字段（关联 ID + 上下文维度）。
     * 内部复用，不导出。
     */
    private buildToolBaseContext;
    private buildRequestSuccessEventFields;
    private buildRequestErrorEventFields;
    private buildMessageErrorEventFields;
    private buildToolBaseEventFields;
    /** 推导工具的能力归属（capability_type + capability_id），plugin 判定走注入的 registry。 */
    private resolveCapability;
    private addRootSpanEvent;
    private addToolSpanEvent;
    private cleanSpanEventAttributes;
    /**
     * 提取用户 uid。
     * 优先 `session.meta['codebuddy.ai/userId']`（Renderer 透传，desktop 场景必需，
     * 因为 CLI 是子进程没本地登录态）；缺失时回落到 CLI 本地 `AuthenticationManager`
     * （裸 cli / IDE 插件场景）。两者都没有则返回 ''。
     */
    private extractUid;
    /** 场景标识：先取本轮 baggage，再回落 session.meta['codebuddy.ai/mode']；都缺失返回 '' */
    private extractScene;
    /**
     * 取 expert 会话标识（Renderer 召唤 expert 后经 ACP _meta 透传，
     * 由 applyUpstreamMeta 写入 session.meta['codebuddy.ai/expertId']）。
     * 非 expert 会话 / 裸 CLI 返回 ''，不影响其它归因。
     */
    private extractExpertId;
    /** 优先取 session.agentName，再 fallback 到 session.meta.agentName */
    private extractAgentName;
    /** Role of the Session's agent loop, for request-level events. */
    private extractAgentType;
    /** Role of the call in the current async chain (X-Agent-Type), for tool events. */
    private extractCallAgentType;
    /** 从 error.status / error.response.status 提取 HTTP 状态码 */
    private extractHttpStatus;
    /** 从 error.code 提取 Node.js errno（ECONNRESET 等） */
    private extractNodeErrorCode;
    /** 从嵌套 error 提取最具体的 message-level errorCode（保留旧 session-manager 逻辑） */
    private extractMessageErrorCode;
}
