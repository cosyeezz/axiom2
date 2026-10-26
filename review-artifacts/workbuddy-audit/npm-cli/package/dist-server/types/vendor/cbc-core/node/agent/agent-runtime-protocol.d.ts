import type { Agent, AgentInputItem, RawModelProvider } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
import type { AgentRunInterceptor } from './agent-protocol';
import type { ToolCallLoopHit } from './tool-call-loop-pattern';
export declare const AgentRuntimeResolver: unique symbol;
export interface AgentRuntimeResolver {
    resolveAgentForSession(session?: Session): Promise<Agent>;
}
export declare const AgentPluginRefresh: unique symbol;
export interface AgentPluginRefresh {
    waitForRefreshSettled(): Promise<void>;
    waitForComposePluginsReady(): Promise<void>;
}
export declare const AgentRunObserver: unique symbol;
export type AgentRunStage = 'resolve-agent' | 'authentication' | 'runner-initialization' | 'plugin-runtime-join' | 'interceptor' | 'tool-refresh' | 'runner-tool-collection' | 'runner-system-prompt' | 'runner-model-input-filter';
export type AgentRunEvent = 'runner-dispatch';
export type AgentRunStageStatus = 'ok' | 'error' | 'aborted' | 'blocked' | 'skipped' | 'timeout';
export interface AgentRunObservationData {
    requestId?: string;
    requestIdMayChange?: boolean;
    deferStart?: boolean;
    otelAlreadyObserved?: boolean;
    emitOtel?: boolean;
    attributes?: Record<string, unknown>;
}
export interface AgentRunObserver {
    enterJobActivity(): () => void;
    resolveInterceptorName(interceptor: AgentRunInterceptor): string;
    markStart(phase: string, label?: string): void;
    markEnd(phase: string): void;
    begin(phase: string, label: string): unknown;
    end(span: unknown, status?: 'error'): void;
    isRunStageEnabled?(stage: AgentRunStage): boolean;
    beginRunStage?(session: Session, stage: AgentRunStage, data?: AgentRunObservationData): unknown;
    endRunStage?(stage: unknown, status?: AgentRunStageStatus, data?: AgentRunObservationData): void;
    recordRunEvent?(session: Session, event: AgentRunEvent, data?: AgentRunObservationData): void;
}
export declare const AgentToolRuntime: unique symbol;
export interface AgentToolRuntime {
    rewriteArguments(argumentsText: string): unknown;
    enterToolCall(callId: string, toolName: string, sessionId?: string): void;
    leaveToolCall(callId: string): void;
    isPolicyDeniedResult(output: unknown): output is {
        terminal: {
            reason: 'policy-denied';
            finalOutput: string;
        };
    };
}
export declare const AgentQueueOutput: unique symbol;
export interface AgentQueueOutput {
    broadcastMessageQueueUpdate(sessionId: string, queueData: Record<string, unknown>): Promise<void>;
    broadcastUserMessage(sessionId: string, text: string, excludeConnectionId: string, images: undefined, tracking: {
        requestId: string;
        messageRequestId?: string;
        userEntryId?: string;
        conversationRequestId?: string;
    }, session: Session, timestamp: undefined, clientMeta?: unknown): Promise<void>;
}
export declare const AgentRunSettings: unique symbol;
export interface AgentRunSettingsValues {
    autoCompactWindow?: number;
    autoCompactEnabled?: boolean;
}
export interface AgentRunSettings {
    get<K extends keyof AgentRunSettingsValues>(key: K): Promise<AgentRunSettingsValues[K]>;
}
export declare const RunnerModelProvider: unique symbol;
export interface RunnerModelProvider extends RawModelProvider {
    /** Host projects persisted input content into provider-supported model content. */
    projectInput?(input: AgentInputItem[]): AgentInputItem[] | Promise<AgentInputItem[]>;
}
/** Optional host attachment generated before each model step, including tool continuations. */
export declare const ModelStepAttachmentProvider: unique symbol;
export interface ModelStepAttachmentProvider {
    /** Reinsert persisted attachments into SDK continuations, which omit filter-added items. */
    restoreAttachments?(input: AgentInputItem[], session: Session): void;
    getAttachment(input: AgentInputItem[], session: Session, availableToolNames: readonly string[], agentName?: string): Promise<AgentInputItem | undefined>;
}
export interface ToolCallLoopEvidence extends ToolCallLoopHit {
    toolName: string;
}
export type ToolCallLoopEventKind = 'suspected' | 'continue' | 'auto_continue' | 'detected';
export declare const AgentLoopTelemetry: unique symbol;
export interface AgentLoopTelemetry {
    reportUserTaskFailedCreditRefund(session: Session, reason: 'loop_detected'): Promise<void>;
    reportToolCallLoopEvent(kind: ToolCallLoopEventKind, session: Session, evidence: ToolCallLoopEvidence): Promise<void>;
}
export interface AgentLoopCancellation {
    cancel(request: {
        sessionId: string;
        _meta: Record<string, string>;
    }): Promise<unknown>;
}
export declare const AgentLoopInteraction: unique symbol;
export interface AgentLoopInteraction {
    isEnabled(): boolean;
    getCancellationForSession(session: Session): AgentLoopCancellation | undefined;
    readonly cancelReasonKey: string;
    readonly cancelledReason: string;
    readonly interceptType: string;
}
//# sourceMappingURL=agent-runtime-protocol.d.ts.map