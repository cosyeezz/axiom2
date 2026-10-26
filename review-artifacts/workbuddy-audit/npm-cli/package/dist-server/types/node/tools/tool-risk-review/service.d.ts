import { Logger } from '@genie/telemetry';
import { type McpServerModelManager as IMcpServerModelManager } from '../../mcp/mcp-protocol';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../../security-review';
import { type SensitiveModelBoundary as ISensitiveModelBoundary } from '../../sensitive-content/sensitive-content-protocol';
import { type SettingsManager as ISettingsManager } from '../../settings/settings-protocol';
import { type SandboxTelemetryReporter as ISandboxTelemetryReporter } from '../../telemetry/sandbox-telemetry-protocol';
import { ToolResultContentReviewer } from './content-review';
import { type ToolRiskProjectorRegistry } from './projector-registry';
import { type AuthorizeExecutionInput, type ExecutionApprovalAdapter as IExecutionApprovalAdapter, type ExecutionAuthorization, type RecheckFinalActionInput, type ReviewPermissionInput, type ReviewPermissionResult, type ToolIdentity, type ToolRiskApprovalDecisionInput, type ToolRiskApprovalMetadata, type ToolRiskExecutionStatus, type ToolRiskHostDeniedInput, type ToolRiskReviewService as IToolRiskReviewService } from './protocol';
import { type ToolRiskReviewClient as IToolRiskReviewClient } from './reviewer-client';
import { ToolRiskReviewSessionStateStore } from './session-state';
export { MAX_TOOL_RISK_REVIEW_RECORDS } from './session-state';
export declare class ToolRiskReviewStateCapacityError extends Error {
    constructor();
}
export declare class ToolRiskReviewServiceImpl implements IToolRiskReviewService {
    protected readonly securityReviewGate: SecurityReviewGateContract;
    protected readonly reviewerClient: IToolRiskReviewClient;
    protected readonly sandboxTelemetryReporter?: ISandboxTelemetryReporter;
    protected readonly logger?: Logger;
    protected readonly settingsManager?: ISettingsManager;
    protected readonly contentReviewer: ToolResultContentReviewer;
    protected readonly sensitiveModelBoundary?: ISensitiveModelBoundary;
    protected readonly contentApprovalAdapter?: IExecutionApprovalAdapter;
    protected readonly mcpServerModelManager?: IMcpServerModelManager;
    private readonly contentAdmissions;
    private readonly pendingContentApprovals;
    /** 未注入时 project 使用审查运行时内置投影器，createActionHash 直接使用 Host 哈希。 */
    protected projectorRegistry?: ToolRiskProjectorRegistry;
    private readonly trustedBuiltinCalls;
    private readonly builtinQueryCaches;
    protected readonly sessionStates: ToolRiskReviewSessionStateStore;
    reviewPermission(input: ReviewPermissionInput): Promise<ReviewPermissionResult>;
    recordHostDenied(input: ToolRiskHostDeniedInput): void;
    getPendingApproval(session: ReviewPermissionInput['session'], toolCallId: string): ToolRiskApprovalMetadata | undefined;
    recordApprovalDecision(input: ToolRiskApprovalDecisionInput): void;
    private reportApproval;
    markCancelled(session: ReviewPermissionInput['session'], toolCallId: string): void;
    private emitTelemetry;
    consumeApproval(input: Omit<ToolRiskApprovalDecisionInput, 'decision' | 'reviewId'>): boolean;
    authorizeExecution(input: AuthorizeExecutionInput): Promise<ExecutionAuthorization>;
    recheckFinalAction(input: RecheckFinalActionInput): Promise<ExecutionAuthorization>;
    recordExecutionStatus(session: ReviewPermissionInput['session'], toolCallId: string, status: ToolRiskExecutionStatus): void;
    recordBuiltinToolCall(session: ReviewPermissionInput['session'], toolName: string, toolCallId: string): void;
    recordMcpToolCall(session: ReviewPermissionInput['session'], identity: Extract<ToolIdentity, {
        source: 'mcp';
    }>, toolCallId: string): void;
    private recordToolResultIdentity;
    recordBuiltinToolResult(session: ReviewPermissionInput['session'], toolName: string, toolCallId: string, outcome: 'succeeded' | 'failed'): void;
    recordMcpToolResult(session: ReviewPermissionInput['session'], identity: Extract<ToolIdentity, {
        source: 'mcp';
    }>, toolCallId: string, outcome: 'succeeded' | 'failed'): void;
    private recordToolResultOutcome;
    markResultProtectionIncomplete(session: ReviewPermissionInput['session'], toolName: string, toolCallId: string): void;
    /**
     * 在 hook 与 IDE 改写之后、执行之前登记最终参数；工具返回的豁免只认这里的判定，
     * 未登记的调用（如恢复的历史会话）按不可信处理。
     */
    recordExecutedToolInput(session: ReviewPermissionInput['session'], toolCallId: string, toolName: string, finalInput: unknown): void;
    recordTrustedHostResult(session: ReviewPermissionInput['session'], toolCallId: string): void;
    /** 同一调用复用执行环境一致的 shell 查询，最终来源判定仍使用当前参数与文件系统。 */
    isTrustedBuiltinCodeAction(session: ReviewPermissionInput['session'], toolCallId: string, toolName: string, toolInput: unknown, cwd?: string): Promise<boolean>;
    /**
     * 这次调用的合并环境：探测与执行共用宿主 shell 环境策略的同一份回答。
     * 只有启动进程的工具询问宿主。
     */
    private callEnvironment;
    isTrustedBuiltinCall(session: ReviewPermissionInput['session'], toolCallId: string): Promise<boolean>;
    admitToolContent(session: ReviewPermissionInput['session'], toolCallId: string, content: unknown, toolName?: string): Promise<boolean>;
    private reviewToolContent;
    protectModelRequest(session: ReviewPermissionInput['session'], modelInput: unknown): Promise<unknown>;
    private reconcileResultIdentityLedger;
    private prepareActionHash;
    private createActionHash;
    private wrapToolMessageContent;
    private injectTrustInstructions;
    private reportResultProtectionFailure;
    private reportResultProtection;
    private createApproval;
    private fallbackUnreviewedAction;
    private saveRecord;
    private currentReviewPolicyFingerprint;
    private report;
}
