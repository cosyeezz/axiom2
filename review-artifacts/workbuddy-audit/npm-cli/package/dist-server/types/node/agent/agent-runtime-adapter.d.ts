import { type AgentLoopCancellation, AgentLoopInteraction, AgentLoopTelemetry, AgentManager, AgentPluginRefresh, AgentQueueOutput, type AgentRunEvent, type AgentRunInterceptor, type AgentRunObservationData, AgentRunObserver, AgentRunSettings, type AgentRunSettingsValues, type AgentRunStage, type AgentRunStageStatus, AgentRuntimeResolver, AgentToolRuntime, RunnerModelProvider, type Session, SessionManager, type ToolCallLoopEventKind, type ToolCallLoopEvidence } from '../../vendor/cbc-core/node/index.js';
import { PluginRuntimeRefreshService } from '../../vendor/cbc-plugins/node/index.js';
import type { Agent } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { AcpBroadcastService } from '../acp/acp-protocol';
import { ImageBlobService } from '../blob-store/blob-store-protocol';
import { ModelProvider } from '../model/model-protocol';
import { SettingsManager } from '../settings';
import { type CliExecutionPhase } from '../telemetry/cli-execution-observer';
import { TelemetryService } from '../telemetry/telemetry-protocol';
import { ToolArgumentRewriteService } from '../tools/tool-protocol';
import { projectPromptFilesForModel } from '../utils/embedded-resource';
import { MainAgentGateProvider } from './main-agent-resolver';
export declare class CliAgentRuntimeResolver implements AgentRuntimeResolver {
    protected readonly agentManager: AgentManager;
    protected readonly sessionManager: SessionManager;
    protected readonly settingsManager: SettingsManager;
    protected readonly mainAgentGateProvider?: MainAgentGateProvider;
    protected readonly logger: Logger;
    resolveAgentForSession(session?: Session): Promise<Agent>;
}
export declare class CliAgentPluginRefresh implements AgentPluginRefresh {
    protected readonly refresh?: PluginRuntimeRefreshService;
    waitForRefreshSettled(): Promise<void>;
    waitForComposePluginsReady(): Promise<void>;
}
export declare class CliAgentToolRuntime implements AgentToolRuntime {
    protected readonly argumentRewrite: ToolArgumentRewriteService;
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
export declare class CliAgentQueueOutput implements AgentQueueOutput {
    protected readonly broadcast?: AcpBroadcastService;
    broadcastMessageQueueUpdate(sessionId: string, queueData: Record<string, unknown>): Promise<void>;
    broadcastUserMessage(...args: Parameters<AgentQueueOutput['broadcastUserMessage']>): Promise<void>;
}
export declare class CliAgentRunSettings implements AgentRunSettings {
    protected readonly settings: SettingsManager;
    get<K extends keyof AgentRunSettingsValues>(key: K): Promise<AgentRunSettingsValues[K]>;
}
export declare class CliRunnerModelProvider implements RunnerModelProvider {
    protected readonly imageBlobService: ImageBlobService;
    protected readonly settingsManager: SettingsManager;
    projectInput(input: Parameters<typeof projectPromptFilesForModel>[0]): Promise<ReturnType<typeof projectPromptFilesForModel>>;
    protected readonly provider: ModelProvider;
    getModel(modelName: Parameters<RunnerModelProvider['getModel']>[0]): ReturnType<RunnerModelProvider['getModel']>;
}
export declare class CliAgentRunObserver implements AgentRunObserver {
    enterJobActivity(): () => void;
    resolveInterceptorName(interceptor: AgentRunInterceptor): string;
    markStart(phase: string, label?: string): void;
    markEnd(phase: string): void;
    begin(phase: string, label: string): unknown;
    end(span: unknown, status?: 'error'): void;
    isRunStageEnabled(_stage: AgentRunStage): boolean;
    beginRunStage(session: Session, stage: AgentRunStage, data?: AgentRunObservationData): CliExecutionPhase;
    endRunStage(stage: unknown, status?: AgentRunStageStatus, data?: AgentRunObservationData): void;
    recordRunEvent(session: Session, event: AgentRunEvent, data?: AgentRunObservationData): void;
    private profiler;
}
export declare class CliAgentLoopTelemetry implements AgentLoopTelemetry {
    protected readonly telemetry: TelemetryService;
    reportUserTaskFailedCreditRefund(session: Session, reason: 'loop_detected'): Promise<void>;
    reportToolCallLoopEvent(kind: ToolCallLoopEventKind, session: Session, evidence: ToolCallLoopEvidence): Promise<void>;
}
export declare class CliAgentLoopInteraction implements AgentLoopInteraction {
    readonly cancelReasonKey: "codebuddy.ai/cancelReason";
    readonly cancelledReason: "tool_call_loop_stopped";
    readonly interceptType: "tool-call-loop";
    isEnabled(): boolean;
    getCancellationForSession(session: Session): AgentLoopCancellation | undefined;
}
