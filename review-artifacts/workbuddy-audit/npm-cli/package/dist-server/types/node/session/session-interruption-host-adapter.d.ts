import { type InterruptionToolRiskApprovalMetadata, type Session, SessionApprovalMemoryHost, SessionBackgroundApprovalHost, SessionChannelPermissionHost, SessionInterruptionBroadcastHost, SessionInterruptionInteractionHost, SessionInterruptionProfilerHost, SessionInterruptionRecoveryHost, SessionInterruptionSecurityHost, SessionInterruptionToolHost, SessionInterruptionTraceHost, SessionPermissionHookHost, SessionSdkPermissionHost } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, type RunToolApprovalItem } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { AcpBroadcastService } from '../acp/acp-protocol';
import { rewriteUnknownToolForCodeMode } from '../agent/main-agent-session';
import { BackgroundTaskToolApprovalService } from '../agent-task/agent-task-protocol';
import { resolveSessionAskUserQuestionHandler } from '../ask/session-ask-user-question-handler';
import { ChannelPermissionAdapter } from '../channel/channel-protocol';
import { SdkHooksManager, SdkPermissionClient } from '../control-signal/control-signal-protocol';
import { isLibraryRuntime } from '../library-runtime';
import { shouldKeepLiveDetachedWorkerHitl } from '../multitask/session-flags';
import { isUnrestrictedPermissionMode } from '../permission/codebuddy-sandbox-env';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../security-review/protocol';
import { type SettingsManager as SettingsManagerContract } from '../settings/settings-protocol';
import { bindResolvedSkillApprovalDecision, clearResolvedSkillApprovalDecision, getBoundSkillApprovalDecision, resolveSkillApprovalRejectionContent } from '../skills/skill-approval';
import { type SandboxTelemetryReporter as SandboxTelemetryReporterContract } from '../telemetry/sandbox-telemetry-protocol';
import { StartupProfiler } from '../telemetry/startup-profiler-protocol';
import { PlanStorageService } from '../tools/plan-storage-service';
import { getSandboxReviewOperation } from '../tools/sandbox-approval-review';
import { ToolAlwaysApprovalService, ToolManager } from '../tools/tool-protocol';
import { type ToolRiskReviewService as ToolRiskReviewServiceContract } from '../tools/tool-risk-review/protocol';
type WorkflowSourceResolverType = import('@genie/cbc-workflow').WorkflowSourceResolver;
type TraceCollector = import('../trace/trace-collector-protocol').TraceCollectorService;
export declare class CliSessionInterruptionToolHost implements SessionInterruptionToolHost {
    protected readonly toolManager: ToolManager;
    protected readonly planStorageService: PlanStorageService;
    getPermissionContent(session: Session, item: RunToolApprovalItem): ReturnType<NonNullable<SessionInterruptionToolHost['getPermissionContent']>>;
    resolveRejectedResult(toolName: string, item: FunctionCallItem): ReturnType<SessionInterruptionToolHost['resolveRejectedResult']>;
    isUnrestrictedPermissionMode: typeof isUnrestrictedPermissionMode;
    bindSkillApprovalDecision: typeof bindResolvedSkillApprovalDecision;
    clearSkillApprovalDecision: typeof clearResolvedSkillApprovalDecision;
    getBoundSkillApprovalDecision: typeof getBoundSkillApprovalDecision;
    resolveSkillApprovalRejectionContent: typeof resolveSkillApprovalRejectionContent;
    readonly rejectionDisplay: string;
    isDangerousCommand(command: string): boolean;
}
export declare class CliSessionApprovalMemoryHost implements SessionApprovalMemoryHost {
    protected readonly service: ToolAlwaysApprovalService;
    approve(...args: Parameters<SessionApprovalMemoryHost['approve']>): Promise<void>;
    isApproved(...args: Parameters<SessionApprovalMemoryHost['isApproved']>): boolean;
    getSessionApprovalRules(session: Session, item: RunToolApprovalItem): ReturnType<ToolAlwaysApprovalService['getSessionApprovalRules']>;
    /** 单次确认的任务级记忆（issue #139526）：命令门禁 / 技能脚本关联。 */
    rememberTaskScopedApproval(...args: Parameters<NonNullable<SessionApprovalMemoryHost['rememberTaskScopedApproval']>>): void;
}
export declare class CliSessionInterruptionSecurityHost implements SessionInterruptionSecurityHost {
    protected readonly gate: SecurityReviewGateContract;
    protected readonly reviews?: ToolRiskReviewServiceContract;
    protected readonly telemetry?: SandboxTelemetryReporterContract;
    protected readonly logger?: Logger;
    protected readonly settingsManager?: SettingsManagerContract;
    getPermissionMetadata(session: Session, item: RunToolApprovalItem): Record<string, unknown> | undefined;
    getPresentedApproval(item: RunToolApprovalItem, approvalSession?: Session): InterruptionToolRiskApprovalMetadata | undefined;
    attachApproval(session: Session, item: RunToolApprovalItem): InterruptionToolRiskApprovalMetadata | undefined;
    getTrustedApproval(session: Session, item: RunToolApprovalItem): InterruptionToolRiskApprovalMetadata | undefined;
    recordApprovalDecision(input: Parameters<SessionInterruptionSecurityHost['recordApprovalDecision']>[0]): void;
    recordExecutionStatus(session: Session, toolCallId: string, status: 'not_started'): void;
    markCancelled(session: Session, toolCallId: string): void;
    getAssistedApprovalMode(session: Session, scope: 'tool' | 'sandbox'): ReturnType<SecurityReviewGateContract['getAssistedApprovalMode']>;
    getSandboxReviewOperation: typeof getSandboxReviewOperation;
    reviewSandboxOperation(operation: unknown, signal: AbortSignal, context?: Parameters<SessionInterruptionSecurityHost['reviewSandboxOperation']>[2]): ReturnType<SessionInterruptionSecurityHost['reviewSandboxOperation']>;
    recordSandboxReviewResult(session: Session, input: Parameters<NonNullable<SessionInterruptionSecurityHost['recordSandboxReviewResult']>>[1]): void;
    reportAutomaticApprovalOutcome(input: Parameters<NonNullable<SessionInterruptionSecurityHost['reportAutomaticApprovalOutcome']>>[0]): void;
    recordSecurityApprovalDecision(session: Session, input: Parameters<SessionInterruptionSecurityHost['recordSecurityApprovalDecision']>[1]): void;
}
export declare class CliSessionBackgroundApprovalHost implements SessionBackgroundApprovalHost {
    protected readonly service: BackgroundTaskToolApprovalService;
    isBackgroundTaskSession(session: Session): boolean;
    approve(...args: Parameters<SessionBackgroundApprovalHost['approve']>): void;
    handleRejection(...args: Parameters<SessionBackgroundApprovalHost['handleRejection']>): ReturnType<SessionBackgroundApprovalHost['handleRejection']>;
    shouldKeepLiveDetachedWorkerHitl: typeof shouldKeepLiveDetachedWorkerHitl;
}
export declare class CliSessionInterruptionInteractionHost implements SessionInterruptionInteractionHost {
    protected readonly workflowSourceResolver?: WorkflowSourceResolverType;
    protected readonly sdkHooksManager: SdkHooksManager;
    protected readonly logger: Logger;
    resolveAskHandler: typeof resolveSessionAskUserQuestionHandler;
    isLibraryRuntime: typeof isLibraryRuntime;
    /**
     * 同一个判据在 AskUserQuestionTool 的可见性门控里也用着：SDK 没在
     * initialize 里声明这个能力，就没人能渲染问题卡，推过去只会挂死。
     */
    supportsStreamJsonAskUserQuestion(): boolean;
    preloadWorkflowSource(item: RunToolApprovalItem): Promise<void>;
}
export declare class CliSessionSdkPermissionHost implements SessionSdkPermissionHost {
    protected readonly service: SdkPermissionClient;
    requestPermission(...args: Parameters<SessionSdkPermissionHost['requestPermission']>): ReturnType<SessionSdkPermissionHost['requestPermission']>;
    cancelByToolUseId(toolUseId: string, resolvedBy: string, decision?: 'allow' | 'deny'): void;
}
export declare class CliSessionPermissionHookHost implements SessionPermissionHookHost {
    protected readonly service: SdkHooksManager;
    getHooks(event: 'PermissionRequest'): ReturnType<SessionPermissionHookHost['getHooks']>;
    invokeCallback(...args: Parameters<SessionPermissionHookHost['invokeCallback']>): Promise<void>;
}
export declare class CliSessionChannelPermissionHost implements SessionChannelPermissionHost {
    protected readonly service?: ChannelPermissionAdapter;
    isAvailable(): boolean;
    createPermissionRequest(...args: Parameters<SessionChannelPermissionHost['createPermissionRequest']>): ReturnType<SessionChannelPermissionHost['createPermissionRequest']>;
    cancelRequest(toolCallId: string): void;
}
export declare class CliSessionInterruptionBroadcastHost implements SessionInterruptionBroadcastHost {
    protected readonly service?: AcpBroadcastService;
    broadcastInterruptionRequest(...args: Parameters<SessionInterruptionBroadcastHost['broadcastInterruptionRequest']>): Promise<void>;
    broadcastPermissionResolved(...args: Parameters<SessionInterruptionBroadcastHost['broadcastPermissionResolved']>): Promise<void>;
}
export declare class CliSessionInterruptionRecoveryHost implements SessionInterruptionRecoveryHost {
    rewriteUnknownToolForCodeMode: typeof rewriteUnknownToolForCodeMode;
    codeModeDirectCallGuidance(session: Session, toolName: string): string | undefined;
    isDeferredTool(toolName: string): boolean;
    getTasks(): ReturnType<SessionInterruptionRecoveryHost['getTasks']>;
    getDebugEmptyDrainLoopCount(): number;
}
export declare class CliSessionInterruptionTraceHost implements SessionInterruptionTraceHost {
    protected readonly service?: TraceCollector;
    flushSession(...args: Parameters<SessionInterruptionTraceHost['flushSession']>): Promise<number | undefined>;
}
export declare class CliSessionInterruptionProfilerHost implements SessionInterruptionProfilerHost {
    protected get profiler(): StartupProfiler | undefined;
    markStart(phase: string, label: string): void;
    markEnd(phase: string): void;
}
export {};
