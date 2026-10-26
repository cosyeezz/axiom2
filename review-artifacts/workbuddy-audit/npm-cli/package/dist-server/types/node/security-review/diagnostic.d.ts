import type { ReviewerRecovery } from '../../vendor/cbc-core/node/index.js';
import type { SandboxCorrelationFields, SecurityReviewApprovalPayload, SecurityReviewFailureReason, SecurityReviewModelCallPayload, SecurityReviewReasonCode, SecurityReviewType } from '@genie/telemetry';
import { createSandboxTelemetryContext } from '../permission/sandbox-telemetry-context';
type CorrelationSession = Parameters<typeof createSandboxTelemetryContext>[0];
/**
 * 安全审查事件的关联字段，只取统一字段清单，不混入 agentType 等 Sandbox 业务字段。
 * 同一 Session 的同一 Tool Call 以首次调用时的值为准：审查入口先调用一次，之后的审查结论、审批与结果防护都复用这份快照，
 * 期间其他模型请求改写 session.messageId 不影响关联。
 */
export declare function securityReviewCorrelation(session: CorrelationSession | undefined, toolCallId?: string): SandboxCorrelationFields;
/** correlation 须在发起审查时取得，模型调用结算时会话的 messageId 可能已被其他请求改写。 */
export declare function reportSecurityReviewModelCall(call: SecurityReviewModelCallPayload, correlation: SandboxCorrelationFields): void;
export declare const SECURITY_REVIEW_SCOPE_TITLE_KEYS: Record<'sandbox' | 'sensitive' | 'tool_call' | 'tool_result', string>;
interface SecurityReviewDiagnostic {
    reviewType: SecurityReviewType;
    sessionId?: string;
    toolCallId?: string;
    reviewId?: string;
    approvalId?: string;
    toolName?: string;
    outcome: 'allow' | 'deny' | 'suspected' | 'unavailable';
    assistedMode?: SecurityReviewApprovalPayload['assistedMode'];
    decision?: 'allow' | 'deny';
    reasonCode?: SecurityReviewReasonCode;
    category?: string;
    failureReason?: SecurityReviewFailureReason;
    operation?: string;
    summary?: string;
    error?: unknown;
}
export declare function createDiagnosticPreview(text: string): string;
export declare function logSecurityReviewDiagnostic(logger: {
    info(message: string): void;
} | undefined, diagnostic: SecurityReviewDiagnostic): void;
export declare function appendSecurityReviewAudit(diagnostic: SecurityReviewDiagnostic & {
    requestId?: string;
    hostDisposition: 'continue' | 'ask' | 'deny';
    recovery?: ReviewerRecovery;
}, logger?: {
    info(message: string): void;
}): void;
export {};
