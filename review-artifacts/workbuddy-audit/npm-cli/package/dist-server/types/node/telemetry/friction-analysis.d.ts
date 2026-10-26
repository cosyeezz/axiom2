import { ProductManager } from '@genie/product';
import { EventService, Logger } from '@genie/telemetry';
import { ChatRequestSendTelemetry } from '@genie/telemetry/lib/common/event/types/craft';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { FrictionRecallClient } from './friction-recall-client';
export declare const FrictionAnalysisService: unique symbol;
export declare const CHAT_PROMPT_FRICTION_ANALYSIS_EVENT = "chat_prompt_friction_analysis";
export type FrictionSeverity = 'high' | 'medium' | 'low';
export type FrictionType = 'error_tool_failure' | 'performance_friction' | 'repeated_rephrasing' | 'escalation_tone' | 'platform_confusion' | 'abandoned_tool_flow' | 'backtracking_revert' | 'context_churn' | 'quality_disappointment' | 'trust_degradation' | 'communication_mismatch' | 'specification_drift' | 'unexpected_side_effect' | 'data_loss_risk' | 'no_progress_looping' | 'unclear_status' | 'safety_privacy_concern' | 'approval_fatigue' | 'insufficient_evidence';
export type FrictionRootCauseCandidate = 'tool_reliability' | 'model_runtime' | 'product_ux' | 'latency' | 'model_understanding' | 'context_retrieval' | 'output_quality' | 'permission_or_policy' | 'workflow_orchestration' | 'specification_drift' | 'user_requirement_ambiguity' | 'communication_mismatch';
export interface FrictionAnalysisService {
    capturePrompt(session: Session, userPrompt: string): void;
    tryReportOnRequestSend(session: Session, requestTelemetry: ChatRequestSendTelemetry): void;
}
export interface FrictionAnalysisResult {
    frictionType: FrictionType;
    severity: FrictionSeverity;
    evidenceText: string;
    rootCauseCandidate: FrictionRootCauseCandidate;
}
export interface ChatPromptFrictionAnalysisTelemetry {
    conversationId: string;
    requestId: string;
    requestModelId: string;
    requestModelName: string;
    presentAt: number;
    userPrompt: string;
    linkedPreviousRequestId?: string;
    frictionType: FrictionType;
    severity: FrictionSeverity;
    evidenceText: string;
    linkedExecutionSignal?: string;
    rootCauseCandidate: FrictionRootCauseCandidate;
}
export declare function extractVisibleUserPromptFromAcpPrompt(prompt: unknown): string;
export declare function extractVisibleUserPromptFromAgentInput(input: unknown): string;
export declare function buildFrictionTelemetryPayload(session: Session, requestTelemetry: ChatRequestSendTelemetry, userPrompt: string, result: FrictionAnalysisResult, linkedPreviousRequestId?: string, linkedExecutionSignal?: string): ChatPromptFrictionAnalysisTelemetry;
export declare class FrictionAnalysisServiceImpl implements FrictionAnalysisService {
    protected readonly eventService: EventService;
    protected readonly logger: Logger;
    protected readonly frictionRecallClient: FrictionRecallClient;
    protected readonly productManager: ProductManager;
    private readonly pendingPromptBySession;
    private readonly pendingAnalysisByRequest;
    private readonly reportedKeys;
    capturePrompt(session: Session, userPrompt: string): void;
    tryReportOnRequestSend(session: Session, requestTelemetry: ChatRequestSendTelemetry): void;
    private flushPending;
    private isFeatureEnabledForReport;
    private getRequestKey;
    private extractLinkedPreviousRequestId;
    private findRequestId;
    private extractLinkedExecutionSignal;
}
