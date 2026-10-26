import type { SecurityReviewConclusion } from '@genie/agent-client-protocol';
import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { ModelCallGeneration, ModelResponseMetadata, Session } from './session-protocol';
export declare const SessionCheckpointHost: unique symbol;
export interface SessionCheckpointHost {
    createCheckpoint(session: Session): Promise<void>;
}
export declare const SessionPermissionInitializer: unique symbol;
export interface SessionPermissionInitializer {
    initializeContext(session: Session): Promise<void>;
}
export declare const SessionProgressHost: unique symbol;
export interface SessionProgressHost {
    start(session: Session): Promise<void>;
    stop(sessionId: string): void;
}
export declare const SessionTaskLifecycleHost: unique symbol;
export interface SessionTaskLifecycleHost {
    clearBySession(sessionId: string): Promise<void>;
}
export declare const SessionBackgroundTaskHost: unique symbol;
export interface SessionBackgroundTaskHost {
    getBackgroundTasks(): ReadonlyArray<{
        status: string;
    }>;
}
export declare const SessionSchedulerHost: unique symbol;
export interface SessionSchedulerHost {
    start(session: Session): void;
    stop(sessionId: string): void;
}
export declare const SessionInboxHost: unique symbol;
export interface SessionInboxHost {
    register(session: Session): void;
    unregister(sessionId: string): void;
}
export declare const SessionSandboxReleaseHost: unique symbol;
export interface SessionSandboxReleaseHost {
    releaseSessionHttpIntercept(sessionId: string): void;
}
export declare const SessionTitleHost: unique symbol;
export interface SessionTitleHost {
    update(title: string): void;
}
export declare const SessionSensitiveProjectionHost: unique symbol;
export interface SessionSensitiveProjectionHost {
    get(historyItem: AgentInputItem): AgentInputItem | undefined;
    link(historyItem: AgentInputItem, runtimeItem: AgentInputItem): void;
}
export declare const SessionSecurityReviewHost: unique symbol;
export interface SessionSecurityReviewHost {
    releaseSession(sessionId: string): void;
    isContentReviewEnabled(session: Session): boolean;
    canPrefetchContentReview(session: Session): Promise<boolean>;
    startContentReview(session: Session, item: AgentInputItem): void;
    beginTurn(session: Session): void;
    attachConclusions(session: Session, item: AgentInputItem): SecurityReviewConclusion[] | undefined;
    broadcastConclusions(session: Session, item: AgentInputItem, conclusions: SecurityReviewConclusion[]): void;
}
export interface SessionResponseUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    requests?: number;
    inputTokensDetails?: Record<string, number>;
    outputTokensDetails?: Record<string, number>;
}
export declare const SessionResponseTelemetryHost: unique symbol;
export interface SessionResponseTelemetryHost {
    reportChatRequestResponseTelemetry(session: Session, result: NonNullable<Session['resultSubject']['value']>, isSuccessful: boolean, error: unknown, metadata: ModelResponseMetadata): Promise<void>;
    reportMessageResponseTelemetryStream(session: Session, usage: SessionResponseUsage | undefined, metadata: ModelResponseMetadata, error: unknown): Promise<void>;
    /** Status of one model call (`generation`); run failures no model call owns are not reported. */
    reportChatMessageStatus(session: Session, errorCode: string, generation: ModelCallGeneration, error?: unknown): Promise<void>;
}
export type SessionResponseTelemetrySnapshot = Pick<NonNullable<Session['telemetry']>, 'modelId' | 'modelName' | 'currentTurn' | 'traceId'>;
export declare const SessionResponseObserver: unique symbol;
export interface SessionResponseObserver {
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
//# sourceMappingURL=session-manager-host-protocol.d.ts.map