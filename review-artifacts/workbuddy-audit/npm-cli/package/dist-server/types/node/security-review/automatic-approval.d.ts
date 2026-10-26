import type { SecurityReviewConclusion } from '@genie/agent-client-protocol';
import type { Session } from '../../vendor/cbc-core/node/index.js';
interface SecurityApprovalDecision {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    scope: 'sandbox' | 'sensitive' | 'tool_call' | 'tool_result';
    decision: 'allow' | 'deny';
    decidedBy: 'ai' | 'user' | 'policy';
    reason?: string;
    /** 审查建议仅用于审计，不作为用户授权或主模型上下文。 */
    reviewDecision?: 'allow' | 'deny';
    reviewReason?: string;
    reviewReasonCode?: SecurityReviewConclusion['reasonCode'];
    credit?: number;
    entryCount?: number;
    reasonCode?: SecurityReviewConclusion['reasonCode'];
    contentPreview?: string;
    visibleInConversation?: boolean;
    visibleInModelContext?: boolean;
    writeAudit?: boolean;
}
export declare function releaseSecurityApprovalDecisions(sessionId: string): void;
export declare function recordSecurityApprovalDecision(session: Session, approval: SecurityApprovalDecision): void;
export declare function attachSecurityReviewConclusions(session: Session, item: {
    type?: string;
    callId?: string;
    providerData?: Record<string, unknown>;
}): SecurityReviewConclusion[] | undefined;
export declare function appendSecurityApprovalContext(session: Session, input: unknown): unknown;
export {};
