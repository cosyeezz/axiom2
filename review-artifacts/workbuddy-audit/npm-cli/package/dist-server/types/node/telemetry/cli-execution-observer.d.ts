import { type Session } from '../../vendor/cbc-core/node/index.js';
export type CliExecutionPhaseStatus = 'ok' | 'error' | 'aborted' | 'blocked' | 'skipped' | 'timeout';
export interface CliExecutionPhase {
    end(status?: CliExecutionPhaseStatus, data?: Record<string, unknown>, requestId?: string): void;
}
export interface CliModelUsageObservation {
    agentName: string;
    requestedModel: string;
    responseModel?: string;
    modelRequestId: string;
    rawUsage: Record<string, unknown>;
    elapsedMs?: number;
    finishReason?: string;
}
export declare function beginCliExecutionPhase(session: Session, phase: string, options?: {
    requestId?: string;
    data?: Record<string, unknown>;
    deferRequestBinding?: boolean;
    emitOtel?: boolean;
}): CliExecutionPhase;
export declare function emitCliExecutionEvent(session: Session, event: string, options?: {
    requestId?: string;
    data?: Record<string, unknown>;
}): void;
export declare function emitCliModelUsageEvent(session: Session, observation: CliModelUsageObservation): void;
