import type { SecurityReviewConclusion } from '@genie/agent-client-protocol';
import { CheckpointService } from '@genie/cbc-checkpoint';
import { type ModelCallGeneration, type ModelResponseMetadata, type Session, SessionBackgroundTaskHost, SessionCheckpointHost, SessionInboxHost, SessionPermissionInitializer, SessionProgressHost, SessionResponseObserver, SessionResponseTelemetryHost, type SessionResponseTelemetrySnapshot, type SessionResponseUsage, SessionSandboxReleaseHost, SessionSchedulerHost, SessionSecurityReviewHost, SessionSensitiveProjectionHost, SessionTaskLifecycleHost, SessionTitleHost } from '../../vendor/cbc-core/node/index.js';
import { type CronSchedulerServiceInterface } from '@genie/cbc-cron';
import { type PidFileEntry } from '@genie/cbc-daemon';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { AgentTaskManager } from '../agent-task/agent-task-protocol';
import { GalileoSessionBridge } from '../galileo/galileo-session-bridge-protocol';
import { ProgressSyncService } from '../notification/notification-protocol';
import { type SecurityReviewGate as SecurityReviewGateContract } from '../security-review/protocol';
import { type SensitiveProtectionPolicy as ISensitiveProtectionPolicy } from '../sensitive-content/sensitive-content-protocol';
import { TelemetryService } from '../telemetry/telemetry-protocol';
import { ToolManager } from '../tools/tool-protocol';
import { ToolResultContentReviewer } from '../tools/tool-risk-review/content-review';
import { type ToolRiskReviewService as ToolRiskReviewServiceContract } from '../tools/tool-risk-review/protocol';
export declare class SessionCheckpointHostImpl implements SessionCheckpointHost {
    protected readonly checkpoints: CheckpointService;
    createCheckpoint(session: Session): Promise<void>;
}
export declare class SessionPermissionInitializerImpl implements SessionPermissionInitializer {
    initializeContext(session: Session): Promise<void>;
}
export declare class SessionProgressHostImpl implements SessionProgressHost {
    protected readonly progress: ProgressSyncService;
    start(session: Session): Promise<void>;
    stop(sessionId: string): void;
}
export declare class SessionTaskLifecycleHostImpl implements SessionTaskLifecycleHost {
    protected readonly tasks: AgentTaskManager;
    clearBySession(sessionId: string): Promise<void>;
}
export declare class SessionBackgroundTaskHostImpl implements SessionBackgroundTaskHost {
    protected readonly tools: ToolManager;
    getBackgroundTasks(): ReadonlyArray<{
        status: string;
    }>;
}
export declare const CRON_READY_META_KEY = "cronReady";
export declare const CRON_READY_AT_META_KEY = "cronReadyAt";
export declare const CRON_STORAGE_DIR_META_KEY = "cronStorageDir";
export declare const CRON_READY_LEASE_MS = 15000;
export declare function hasPreferredDaemonScheduler(entries: PidFileEntry[], storageDir: string, currentPid?: number, now?: number): boolean;
/**
 * 不承载项目持久化定时任务的进程类型：后台 job（如 `--print` 跑完常驻 idle）与团队队友。
 * 它们拿到调度锁后，执行会挂在用户看不见的进程上，且「查看实时过程」无法直达。
 * 本会话任务（/loop 等）不受影响。
 */
export declare function isNonHostingSessionKind(kind: string | undefined): boolean;
export declare class SessionSchedulerHostImpl implements SessionSchedulerHost {
    protected readonly scheduler: CronSchedulerServiceInterface;
    private readonly daemonCronSessions;
    private daemonReadinessTimer;
    start(session: Session): void;
    stop(sessionId: string): void;
    private resolveSessionRegistry;
    private startDaemonReadinessHeartbeat;
    private publishDaemonReadiness;
}
export declare class SessionInboxHostImpl implements SessionInboxHost {
    register(session: Session): void;
    unregister(sessionId: string): void;
}
export declare class SessionSandboxReleaseHostImpl implements SessionSandboxReleaseHost {
    releaseSessionHttpIntercept(sessionId: string): void;
}
export declare class SessionTitleHostImpl implements SessionTitleHost {
    update(title: string): void;
}
export declare class SessionSensitiveProjectionHostImpl implements SessionSensitiveProjectionHost {
    get(historyItem: AgentInputItem): AgentInputItem | undefined;
    link(historyItem: AgentInputItem, runtimeItem: AgentInputItem): void;
}
export declare class SessionSecurityReviewHostImpl implements SessionSecurityReviewHost {
    protected readonly gate: SecurityReviewGateContract;
    protected readonly logger: Logger;
    protected readonly contentReviewer: ToolResultContentReviewer;
    protected readonly sensitivePolicy: ISensitiveProtectionPolicy;
    protected readonly riskReview?: ToolRiskReviewServiceContract;
    canPrefetchContentReview(session: Session): Promise<boolean>;
    isContentReviewEnabled(session: Session): boolean;
    startContentReview(session: Session, item: AgentInputItem): void;
    releaseSession(sessionId: string): void;
    beginTurn(session: Session): void;
    attachConclusions(session: Session, item: AgentInputItem): SecurityReviewConclusion[] | undefined;
    broadcastConclusions(session: Session, item: AgentInputItem, conclusions: SecurityReviewConclusion[]): void;
}
export declare class SessionResponseTelemetryHostImpl implements SessionResponseTelemetryHost {
    protected readonly telemetry: TelemetryService;
    reportChatRequestResponseTelemetry(session: Session, result: NonNullable<Session['resultSubject']['value']>, isSuccessful: boolean, error: unknown, metadata: ModelResponseMetadata): Promise<void>;
    reportMessageResponseTelemetryStream(session: Session, usage: SessionResponseUsage | undefined, metadata: ModelResponseMetadata, error: unknown): Promise<void>;
    reportChatMessageStatus(session: Session, errorCode: string, generation: ModelCallGeneration, error?: unknown): Promise<void>;
}
export declare class SessionResponseObserverImpl implements SessionResponseObserver {
    protected readonly bridge: GalileoSessionBridge;
    emitRequestStart(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined): void;
    emitMessageStart(session: Session): void;
    emitRequestSuccess(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, metadata: ModelResponseMetadata): void;
    addRequestSuccessSpanEvent(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, metadata: ModelResponseMetadata): void;
    emitRequestError(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, error: unknown, metadata: ModelResponseMetadata): void;
    addRequestErrorSpanEvent(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, error: unknown, metadata: ModelResponseMetadata): void;
    emitMessageError(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, error: unknown): void;
    addMessageErrorSpanEvent(session: Session, snapshot: SessionResponseTelemetrySnapshot | undefined, error: unknown): void;
    emitMessageSuccess(session: Session): void;
    addMessageSuccessSpanEvent(session: Session): void;
}
