import { type SessionManager as SessionManagerContract } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../security-review/protocol';
import { type SensitiveProtectionAuditAction, type SensitiveProtectionAuditDetail } from '../utils/security-audit-log';
import { type SandboxCenterPort as SandboxCenterPortInterface, type SensitiveApprovalPort as SensitiveApprovalPortInterface, type SensitiveDecisionMediation as SensitiveDecisionMediationInterface, type SensitiveReviewDecision, type SensitiveReviewRequest } from './sensitive-content-protocol';
export declare class SensitiveDecisionMediationImpl implements SensitiveDecisionMediationInterface {
    protected sandboxCenterPort?: SandboxCenterPortInterface;
    protected approvalPort?: SensitiveApprovalPortInterface;
    protected logger?: Logger;
    protected securityReviewGate?: SecurityReviewGateContract;
    protected sessionManager?: SessionManagerContract;
    protected readonly sessionGrants: import("./sensitive-session-grants").SensitiveSessionGrants;
    private readonly failureAuditKeys;
    /** Stores only opaque request identities. Sensitive plaintext never enters this cache. */
    private readonly deniedDecisionScopes;
    /** Serializes post-detection egress decisions within one model turn. */
    private readonly egressDecisionTails;
    /** Coalesces concurrent ingress dialogs without caching denial or timeout decisions. */
    private readonly pendingIngressApprovals;
    /** Reuses the first interactive ingress choice for the rest of one ToolCall. */
    private readonly toolCallIngressApprovals;
    review(request: SensitiveReviewRequest): Promise<SensitiveReviewDecision>;
    private getUnifiedApprovalState;
    private reviewWithState;
    private acquireEgressDecision;
    private requestApproval;
    private requestApprovalWithoutToolCallReuse;
    private automaticProtectionEgressGrantKey;
    private deletePendingIngressApproval;
    private logReviewSafely;
    private warnDetectionFailure;
    private failOpen;
    private approvalTimedOut;
    protected auditSensitiveProtection(action: SensitiveProtectionAuditAction, request: SensitiveReviewRequest, detail?: Omit<SensitiveProtectionAuditDetail, 'sessionId' | 'toolCallId' | 'source' | 'direction'>): void;
    private auditFailure;
    private logReview;
    private allowAndProtect;
    private registerAutomaticProtectionGrants;
    private filterAutomaticProtectionEgress;
    private filterSessionOriginal;
    private reuseSessionProtection;
    private getToolCallIngressApproval;
    private rememberToolCallIngressApproval;
    private forgetToolCallIngressApproval;
    private toolCallIngressApprovalKey;
    private pruneToolCallIngressApprovals;
    private allowedChoicesForDetection;
    private grantSessionId;
    private createAllowAndProtectDecision;
    private isValidDetection;
    private isCleanDetection;
    private isUnsupportedDetection;
    private cancelled;
    private accessDenied;
    private approvalTimedOutDecision;
    private protectionFailed;
    private getDeniedDecisionScopeReason;
    private rememberDeniedDecisionScope;
    private deniedDecisionScopeKey;
    private pruneDeniedDecisionScopes;
    private deny;
}
