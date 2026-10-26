import type { ContentBlock, PermissionDecision, SandboxApprovalReview } from '@genie/agent-client-protocol';
import type { AgentInputItem, ApprovalScope, FunctionCallItem, PermissionMode, RuleValue, RunToolApprovalItem } from '../../../cbc-shared/node/index.js';
import type { TurnSecurityReviewPolicy } from '@genie/product';
import type { ReviewerRecovery } from '../agent/agent-protocol';
import type { Session } from './session-protocol';
/** Tool policy and product-specific feedback; approval state and continuation stay in core. */
export declare const SessionInterruptionToolHost: unique symbol;
export interface SessionInterruptionToolHost {
    /** Read tool-owned approval content without changing arguments or model history. */
    getPermissionContent?(session: Session, item: RunToolApprovalItem): ContentBlock[] | undefined;
    resolveRejectedResult(toolName: string, item: FunctionCallItem): Promise<AgentInputItem[] | undefined>;
    isDangerousCommand(command: string): boolean;
    isUnrestrictedPermissionMode(mode: PermissionMode): boolean;
    bindSkillApprovalDecision(session: Session, item: FunctionCallItem): void;
    clearSkillApprovalDecision(session: Session, callId: string | undefined): void;
    getBoundSkillApprovalDecision(item: {
        providerData?: Record<string, unknown>;
    }): {
        mandatory: boolean;
    } | undefined;
    resolveSkillApprovalRejectionContent(item: FunctionCallItem): string | undefined;
    readonly rejectionDisplay: string;
}
export declare const SessionApprovalMemoryHost: unique symbol;
export interface SessionApprovalMemoryHost {
    approve(session: Session, item: RunToolApprovalItem, scope?: ApprovalScope, ruleToolName?: string): Promise<void>;
    isApproved(session: Session, item: RunToolApprovalItem): boolean;
    /** Rules a host may offer to remember for this pending decision; approve() decides what is kept. */
    getSessionApprovalRules?(session: Session, item: RunToolApprovalItem): RuleValue[];
    /**
     * Record a task-scoped, single-call confirmation (issue #139526). The host uses it
     * to stop re-asking for the same command gate / skill script within the current
     * user request; tools without such memory no-op. Optional: absent host means the
     * single-approval path keeps its historical semantics.
     */
    rememberTaskScopedApproval?(session: Session, item: RunToolApprovalItem): void;
}
export interface InterruptionToolRiskApprovalMetadata {
    source: 'tool_risk_review';
    reviewId: string;
    sessionId: string;
    toolCallId: string;
    projectionHash: string;
    summary: string;
    reasonCode: string;
    allowAlways: boolean;
    sessionApprovalToolName?: string;
    reviewType?: 'tool_call' | 'tool_result';
    recommendedAction?: 'allow_once' | 'cancel';
    assistedMode?: TurnSecurityReviewPolicy['assistedApprovalMode'];
    automaticActionEligible?: boolean;
}
export declare const SessionInterruptionSecurityHost: unique symbol;
export interface SessionInterruptionSecurityHost {
    /** Sanitized policy display fields for host callbacks; no internal approval credentials. */
    getPermissionMetadata?(session: Session, item: RunToolApprovalItem): Record<string, unknown> | undefined;
    getPresentedApproval(item: RunToolApprovalItem, approvalSession?: Session): InterruptionToolRiskApprovalMetadata | undefined;
    attachApproval(session: Session, item: RunToolApprovalItem): InterruptionToolRiskApprovalMetadata | undefined;
    getTrustedApproval(session: Session, item: RunToolApprovalItem): InterruptionToolRiskApprovalMetadata | undefined;
    recordApprovalDecision(input: {
        session: Session;
        approval: InterruptionToolRiskApprovalMetadata;
        decision: 'allow_once' | 'cancel';
        automatic?: boolean;
    }): void;
    markCancelled(session: Session, toolCallId: string): void;
    recordExecutionStatus(session: Session, toolCallId: string, status: 'not_started'): void;
    getAssistedApprovalMode(session: Session, scope: 'tool' | 'sandbox'): TurnSecurityReviewPolicy['assistedApprovalMode'];
    getSandboxReviewOperation(item: RunToolApprovalItem): {
        toolName: string;
    } | undefined;
    reviewSandboxOperation(operation: unknown, signal: AbortSignal, context?: {
        sessionId: string;
        approvalId: string;
        toolCallId: string;
        session?: Session;
        getHostDisposition?: () => 'continue' | 'deny' | undefined;
    }): Promise<(Omit<SandboxApprovalReview, 'approvalId'> & {
        notRunReason?: string;
        recovery?: ReviewerRecovery;
    }) | undefined>;
    recordSandboxReviewResult?(session: Session, input: {
        approvalId: string;
        toolCallId: string;
        operation: unknown;
        review: Omit<SandboxApprovalReview, 'approvalId'> & {
            notRunReason?: string;
            recovery?: ReviewerRecovery;
        };
        hostDisposition?: 'continue' | 'ask' | 'deny';
        cancelled?: boolean;
        assistedMode: TurnSecurityReviewPolicy['assistedApprovalMode'];
    }): void;
    reportAutomaticApprovalOutcome?(input: {
        session: Session;
        toolCallId?: string;
        reviewType: 'tool_call' | 'tool_result' | 'sandbox';
        toolName: string;
        decision: 'allow_once' | 'cancel';
        outcome: 'applied' | 'failed';
        failureReason?: 'permission_mode_blocked' | 'apply_failed';
    }): void;
    recordSecurityApprovalDecision(session: Session, input: {
        approvalId: string;
        toolCallId: string;
        toolName: string;
        scope: 'sandbox';
        decision: 'allow' | 'deny';
        decidedBy: 'ai' | 'user';
        assistedMode?: 'manual' | 'silent' | 'risk_hint';
        reason?: string;
        reviewDecision?: 'allow' | 'deny';
        reviewReason?: string;
        credit?: number;
        visibleInConversation?: boolean;
    }): void;
}
export declare const SessionBackgroundApprovalHost: unique symbol;
export interface SessionBackgroundApprovalHost {
    isBackgroundTaskSession(session: Session): boolean;
    approve(item: RunToolApprovalItem, session: Session): void;
    handleRejection(item: RunToolApprovalItem, session: Session, reason: string): Promise<AgentInputItem[]>;
    shouldKeepLiveDetachedWorkerHitl(request: {
        effectiveToolName: string;
        source: Session;
        sweepSessionId: string;
        reason: string;
    }): boolean;
}
export type InterruptionAskHandler = (request: {
    toolCallId: string;
    input: Record<string, unknown>;
    signal: AbortSignal;
}) => Promise<Record<string, string>>;
export declare const SessionInterruptionInteractionHost: unique symbol;
export interface SessionInterruptionInteractionHost {
    resolveAskHandler(session: Session): InterruptionAskHandler | undefined;
    isLibraryRuntime(): boolean;
    preloadWorkflowSource(item: RunToolApprovalItem): Promise<void>;
    /**
     * stream-json 对端是否在 initialize 里声明了 `capabilities.askUserQuestion`。
     * 双通道判据用它决定「把问题也推给 stream-json」是否有人能接——没声明就
     * 等于没人能答，推过去只会多挂一个永不回收的 pending。
     *
     * 可选：不讲 stream-json 的宿主无需实现。core 把「未实现」当作「不支持」，
     * 双通道因此保持关闭，是安全的默认。
     */
    supportsStreamJsonAskUserQuestion?(): boolean;
}
export declare const SessionSdkPermissionHost: unique symbol;
export interface SessionSdkPermissionHost {
    requestPermission(toolName: string, input: Record<string, unknown>, toolUseId: string): Promise<{
        allowed: boolean;
        reason?: string;
        interrupt?: boolean;
        updatedInput?: Record<string, unknown>;
    }>;
    /**
     * 撤掉一条待决审批并通知端侧收起卡片。双通道里输掉竞速的一方走这里。
     *
     * 与 `SessionInterruptionBroadcastHost.broadcastPermissionResolved`（ACP
     * 侧的同款能力）对称。找不到对应 pending 即无操作——对端早回过或从未发出
     * 都不是错误，重复撤销也必须安全。
     *
     * 可选：不讲 stream-json 的宿主无需实现。
     */
    cancelByToolUseId?(toolUseId: string, resolvedBy: string, decision?: 'allow' | 'deny'): void;
}
export declare const SessionPermissionHookHost: unique symbol;
export interface SessionPermissionHookHost {
    getHooks(event: 'PermissionRequest'): Array<{
        hookCallbackIds: string[];
        timeout?: number;
    }>;
    invokeCallback(callbackId: string, input: {
        hook_event_name: 'PermissionRequest';
        session_id: string;
        transcript_path: string;
        cwd: string;
        tool_name: string;
        tool_input: Record<string, unknown>;
    }, toolUseId: string, timeout: number): Promise<void>;
}
export declare const SessionChannelPermissionHost: unique symbol;
export interface SessionChannelPermissionHost {
    isAvailable(): boolean;
    createPermissionRequest(toolCallId: string, toolName: string, description: string, inputPreview: string): Promise<'allow' | 'allow_always' | 'deny' | 'deny_and_exit_plan'>;
    cancelRequest(toolCallId: string): void;
}
export declare const SessionInterruptionBroadcastHost: unique symbol;
export interface SessionInterruptionBroadcastHost {
    broadcastInterruptionRequest(sessionId: string, item: RunToolApprovalItem, approvalSession?: Session): Promise<void>;
    broadcastPermissionResolved(sessionId: string, toolCallId: string, toolName: string, decision: PermissionDecision): Promise<void>;
}
/** Read-only recovery inputs; retry budgets, history and terminal decisions remain in core. */
export declare const SessionInterruptionRecoveryHost: unique symbol;
export interface SessionInterruptionRecoveryHost {
    rewriteUnknownToolForCodeMode(session: Session, message: string): string | undefined;
    codeModeDirectCallGuidance(session: Session, toolName: string): string | undefined;
    isDeferredTool(toolName: string): boolean;
    getTasks(): ReadonlyArray<{
        id: string;
        status: string;
    }>;
    getDebugEmptyDrainLoopCount(): number;
}
export declare const SessionInterruptionTraceHost: unique symbol;
export interface SessionInterruptionTraceHost {
    flushSession(sessionId: string, options: {
        reason: 'user_rejected' | 'permission_denied' | 'plan_rejected' | 'ask_cancelled';
        cancelledTool: {
            toolName: string;
            callId: string;
            toolInput: string;
            errorMessage: string;
        };
    }): Promise<number | undefined>;
}
export declare const SessionInterruptionProfilerHost: unique symbol;
export interface SessionInterruptionProfilerHost {
    markStart(phase: string, label: string): void;
    markEnd(phase: string): void;
}
//# sourceMappingURL=session-interruption-host-protocol.d.ts.map