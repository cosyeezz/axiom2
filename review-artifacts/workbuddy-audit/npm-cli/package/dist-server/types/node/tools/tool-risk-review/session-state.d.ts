import type { Session } from '../../../vendor/cbc-core/node/index.js';
import type { McpServerModel } from '../../mcp/mcp-protocol';
import type { ReviewerDecision, ReviewStatus, ToolActionProjection, ToolIdentity, ToolRiskApprovalMetadata } from './protocol';
export declare const MAX_TOOL_RISK_REVIEW_RECORDS = 128;
export interface ToolRiskReviewRecord {
    reviewId: string;
    toolIdentity: ToolIdentity;
    inputSchemaFingerprint: string;
    projectionHash: string;
    reviewPolicyFingerprint: string;
    sensitiveProjectionRequired?: boolean;
    reviewerDecision?: ReviewerDecision;
    approvalRequired: boolean;
    userDecision?: 'allow_once' | 'cancel';
    approvalConsumed?: boolean;
    lifecycleComplete?: boolean;
    approvalMetadata?: ToolRiskApprovalMetadata;
    reviewStatus?: ReviewStatus;
    /** Internal exemption binding; a replaced/disconnected registration requires a fresh review. */
    trustedMcpSource?: McpServerModel;
}
export interface ToolRiskReviewSessionState {
    records: Map<string, ToolRiskReviewRecord>;
    cancelledCallIds: Set<string>;
    recentProjections: ToolActionProjection[];
    toolResultIdentities: Map<string, {
        toolIdentity: ToolIdentity;
        terminalStatus?: 'succeeded' | 'failed';
        wrappedResultHashes: Set<string>;
        resultProtectionReported?: boolean;
    }>;
    reportedResultProtectionFailures: Set<string>;
    resultIdentityFailures: Map<string, {
        reason: 'identity_record_failed';
        toolCallId: string;
        toolName: string;
    }>;
    unboundResultIdentityFailure?: {
        reason: 'identity_record_failed';
        toolName: string;
    };
}
export declare class ToolRiskReviewSessionStateStore {
    private readonly states;
    get(session: Session): ToolRiskReviewSessionState;
    setRecord(session: Session, toolCallId: string, record: ToolRiskReviewRecord): boolean;
    isCancelled(session: Session, toolCallId: string): boolean;
    markCancelled(session: Session, toolCallId: string): void;
    getRecord(session: Session, toolCallId: string): ToolRiskReviewRecord | undefined;
    deleteRecord(session: Session, toolCallId: string): void;
    addRecentProjection(session: Session, projection: ToolActionProjection): void;
    recordToolResultIdentity(session: Session, toolCallId: string, toolIdentity: ToolIdentity): 'recorded' | 'already_recorded' | 'identity_record_failed';
    reconcileToolResultIdentities(session: Session, retainedToolCallIds: ReadonlySet<string>): void;
}
export declare function displayToolIdentity(identity: ToolIdentity): string;
