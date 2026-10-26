import type { SandboxRuleContext } from '@genie/agent-client-protocol';
import type { SensitiveCipherProtectionItem as PackageSensitiveCipherProtectionItem, SensitiveCipherProtectionMetadata as PackageSensitiveCipherProtectionMetadata, SensitivePlaintextProtectionItem as PackageSensitivePlaintextProtectionItem, SensitivePlaintextProtectionMetadata as PackageSensitivePlaintextProtectionMetadata, SensitiveProtectionItem as PackageSensitiveProtectionItem, SensitiveProtectionMetadata as PackageSensitiveProtectionMetadata } from '@genie/sandbox-cli/cipher-entry-policy';
import type { CipherEntry, SandboxCenterPort as SharedSandboxCenterPort } from '@genie/sandbox-cli/sensitive-detection';
export declare const SensitiveDecisionMediation: unique symbol;
export declare const SensitiveContentMediation: unique symbol;
export declare const SensitiveToolEgressGuard: unique symbol;
export declare const SensitiveEgressReusePolicy: unique symbol;
export declare const SensitiveModelBoundary: unique symbol;
export declare const SensitiveProtectionPolicy: unique symbol;
export declare const SandboxCenterPort: unique symbol;
export declare const SensitiveApprovalPort: unique symbol;
export declare const SensitiveUserInputReview: unique symbol;
export declare const SENSITIVE_ACCESS_DENIED_CODE = "sensitive_access_denied";
export declare const SENSITIVE_APPROVAL_TIMEOUT_CODE = "sensitive_approval_timeout";
export declare const SENSITIVE_PROTECTION_FAILED_CODE = "sensitive_protection_failed";
export declare const SENSITIVE_APPROVAL_TIMEOUT_MESSAGE: string;
export declare const SENSITIVE_PROTECTION_FAILED_MESSAGE: string;
export declare const SENSITIVE_ACCESS_DENIED_PLACEHOLDER: string;
export declare const SENSITIVE_APPROVAL_TIMEOUT_PLACEHOLDER: string;
export declare const SENSITIVE_PROTECTION_FAILED_PLACEHOLDER: string;
export type SensitiveApprovalChoice = 'allow-original' | 'allow-and-protect' | 'allow-execution' | 'deny';
export interface SensitiveInspectionSource {
    kind: 'text';
    content: string;
}
/**
 * `review()` 可接受的来源。
 *
 * 不含 `'open'`：文件读取的敏感检测已由 decide_file 升 ask 覆盖，ReadOpen 复检
 * 链路在 #120356 被主动废弃，Center 的 read-open 审批只走 SensitiveApprovalPort。
 */
export type SensitiveReviewSource = 'bash' | 'powershell' | 'model-request' | 'mcp-tool' | 'web-search' | 'web-fetch' | 'view-image' | 'http-hook';
/** 审批链路来源：比 review 多一个只由 Center 回调产生的 `'open'`。 */
export type SensitiveApprovalSource = SensitiveReviewSource | 'open';
export interface SensitiveReviewRequest {
    direction: 'ingress' | 'egress';
    source: SensitiveReviewSource;
    inspectionSource: SensitiveInspectionSource;
    /** Ingress lifecycle stage used for Sandbox correlation and diagnostics. */
    detectionStage?: 'user-input' | 'tool-result';
    allowedChoices: SensitiveApprovalChoice[];
    sessionId: string;
    /**
     * Optional logical conversation scope used only for in-process approval
     * reuse. Sandbox Center requests and approval routing still use sessionId.
     */
    grantSessionId?: string;
    /** Current logical user request; used only to suppress repeated denial dialogs in-process. */
    decisionScopeId?: string;
    /** Stable, non-sensitive destination identity used to reuse an egress decision in one turn. */
    destinationKey?: string;
    /**
     * Plaintext values from narrowly trusted outbound fields that may reuse a prior
     * automatic-protection decision. The mediation layer still verifies each value against
     * its session-local automatic-protection fingerprint before suppressing egress approval.
     */
    automaticProtectionEgressCandidates?: readonly string[];
    toolCallId?: string;
    signal?: AbortSignal;
    /** Historical caller preference; service failures currently fail-open for availability. */
    detectionFailureMode?: 'open' | 'closed';
    /** Do not allow a detected request to continue with only a protected subset. */
    requireCompleteProtection?: boolean;
    /**
     * Historical model-request content is protected without reopening an approval dialog.
     * All other review paths remain interactive by default.
     */
    approvalMode?: 'interactive' | 'automatic-protection';
}
export type SensitiveReviewDecision = {
    kind: 'pass';
} | {
    kind: 'allow-original';
} | {
    kind: 'allow-and-protect';
    entryIds: string[];
    entries: CipherEntry[];
    ruleNames?: string[];
} | {
    kind: 'allow-execution';
} | {
    kind: 'deny';
    code: string;
    safeMessage: string;
    /** Plaintexts withheld after a denial or approval timeout; never serialize or log them. */
    deniedPlaintexts?: string[];
};
export interface SensitiveDecisionMediation {
    review(request: SensitiveReviewRequest): Promise<SensitiveReviewDecision>;
}
export interface SensitiveUserInputReviewRequest {
    sessionId: string;
    grantSessionId?: string;
    decisionScopeId?: string;
    /** Tool call whose result is being admitted; used to reuse its first ingress approval. */
    toolCallId?: string;
    inspectionContent: string;
    detectionStage?: 'user-input' | 'tool-result';
    signal?: AbortSignal;
    /**
     * 审批模式。设为 'automatic-protection' 时，跳过用户弹窗直接走静默加密路径。
     * 由内置凭据工具的 sensitiveResultPolicy 驱动，经 SensitiveHistoryAdmissionProcessor 设置。
     */
    approvalMode?: 'interactive' | 'automatic-protection';
}
export type SensitiveUserInputReviewDecision = {
    kind: 'allow';
    /** Entries selected by "allow and protect", applied only at history admission. */
    entries?: CipherEntry[];
    ruleNames?: string[];
} | {
    kind: 'deny';
    code: string;
    safeMessage: string;
};
export interface SensitiveUserInputReview {
    review(request: SensitiveUserInputReviewRequest): Promise<SensitiveUserInputReviewDecision>;
}
export declare class SensitiveUserInputBlockedError extends Error {
    readonly code: string;
    readonly safeMessage: string;
    readonly name = "SensitiveUserInputBlockedError";
    constructor(code: string, safeMessage: string);
}
export declare class SensitiveApprovalTimeoutError extends Error {
    readonly name = "SensitiveApprovalTimeoutError";
    constructor();
}
export type SensitiveCipherProtectionItem = PackageSensitiveCipherProtectionItem;
export type SensitiveCipherProtectionMetadata = PackageSensitiveCipherProtectionMetadata;
export type SensitivePlaintextProtectionItem = PackageSensitivePlaintextProtectionItem;
export type SensitivePlaintextProtectionMetadata = PackageSensitivePlaintextProtectionMetadata;
export type SensitiveProtectionItem = PackageSensitiveProtectionItem;
export type SensitiveProtectionMetadata = PackageSensitiveProtectionMetadata;
export interface ToolEgressReviewRequest {
    sessionId: string;
    /** Logical conversation id shared with the ingress automatic-protection record. */
    grantSessionId?: string;
    toolCallId?: string;
    source: 'web-search' | 'web-fetch' | 'view-image' | 'mcp-tool' | 'http-hook' | 'bash' | 'powershell';
    /** Final business fields that are about to leave the local process. */
    inspectionContent: string;
    /** Current logical user request; grants never cross this boundary. */
    decisionScopeId?: string;
    /** Stable, non-sensitive target identity, for example an origin or MCP tool name. */
    destinationKey?: string;
    signal?: AbortSignal;
}
/** Internal projection after the trusted reuse policy has evaluated the outbound request. */
export interface ResolvedToolEgressReviewRequest extends ToolEgressReviewRequest {
    /**
     * Values selected by a trusted policy for possible automatic-protection reuse. The
     * mediation layer still requires a matching session-local automatic-protection record.
     */
    automaticProtectionEgressCandidates?: readonly string[];
}
export type ToolEgressDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    code: string;
    safeMessage: string;
};
export interface SensitiveContentMediation {
    authorizeToolEgress(request: ResolvedToolEgressReviewRequest): Promise<ToolEgressDecision>;
}
export interface SensitiveToolEgressGuard {
    authorize(request: ToolEgressReviewRequest): Promise<ToolEgressDecision>;
}
/** Selects narrowly trusted outbound values that may reuse automatic protection provenance. */
export interface SensitiveEgressReusePolicy {
    resolveCandidates(request: ToolEgressReviewRequest): Promise<readonly string[] | undefined> | readonly string[] | undefined;
}
export interface SensitiveProtectionPolicy {
    isEnabled(request: {
        sessionId?: string;
        signal?: AbortSignal;
    }): Promise<boolean>;
}
export type SensitiveToolCallReviewInputProjection = {
    status: 'projected';
    localInput: unknown;
    reviewerInput: unknown;
} | {
    status: 'incomplete';
};
export interface SensitiveModelBoundary {
    /** Register item-local mappings in the final request for response restoration. */
    protectRequest(request: {
        sessionId: string;
        body: string;
        ciphertexts?: readonly string[];
        entries?: ReadonlyArray<Readonly<CipherEntry>>;
        signal?: AbortSignal;
    }): Promise<string>;
    /** Decorate a session-bound model with incremental response restoration. */
    wrapModel<T>(model: T, sessionId: string, captureReviewInput?: boolean): T;
    /** Return the existing model-safe projection for one restored Tool Call, if any. */
    getToolCallReviewInputProjection(sessionId: string, toolCallId: string): SensitiveToolCallReviewInputProjection | undefined;
}
export type { CipherEntry, SensitiveDetectionMode, SensitiveApprovalDecision, SensitiveDetectionPolicy, SensitiveCipherHit, SensitiveDetectionOutcome } from '@genie/sandbox-cli/sensitive-detection';
export interface SensitiveApprovalPort {
    requestApproval(request: {
        detectionRef: string;
        ruleContext?: SandboxRuleContext;
        direction: SensitiveReviewRequest['direction'];
        source: SensitiveApprovalSource;
        allowedChoices: SensitiveApprovalChoice[];
        sessionId: string;
        toolCallId?: string;
        /** Opaque HMAC key used to reuse allow-original across worker restarts. */
        originalGrantKey?: string;
        plaintexts: string[];
        ruleNames?: string[];
        maskedSummary?: string;
        destinationKey?: string;
        assistedMode?: 'risk_hint';
        signal?: AbortSignal;
    }): Promise<SensitiveApprovalChoice>;
    /**
     * Best-effort registration over the existing permission transport. Hosts that implement
     * this method must resolve it without surfacing a user approval prompt.
     */
    registerAutomaticProtectionGrant?(request: {
        sessionId: string;
        grantKey: string;
        signal?: AbortSignal;
    }): Promise<void>;
}
export type SandboxCenterPort = SharedSandboxCenterPort;
