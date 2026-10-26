import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type StructuredEventErrorType, type StructuredEventLogger, type StructuredEventRecord, type StructuredEventResult } from '../../vendor/cbc-shared/node/index.js';
export declare const AGENT_MODEL_CALL_COMPLETED_EVENT = "agent.model_call.completed";
export interface ModelCallOutcomeFields {
    model: string;
    step?: number;
    attempt_no: number;
    time_to_first_token_ms?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cached_read_tokens?: number;
    cached_write_tokens?: number;
    finish_reason?: string;
    error_category?: string;
    error_subcategory?: string;
    http_status_code?: number;
    node_error_code?: string;
    retryable?: boolean;
}
export interface ModelCallOutcomeInput extends ModelCallOutcomeFields {
    logger: StructuredEventLogger;
    session: Session;
    conversationRequestId?: string;
    conversationMessageId: string;
    result: StructuredEventResult;
    startedAt: number;
    error?: unknown;
    errorCode?: string;
    errorType?: StructuredEventErrorType;
}
export type ModelCallOutcomeRecord = StructuredEventRecord<ModelCallOutcomeFields>;
export declare function logModelCallOutcome(input: ModelCallOutcomeInput): ModelCallOutcomeRecord | undefined;
export declare function modelCallResultFromError(error: unknown): {
    result: 'failed' | 'cancelled' | 'rejected';
    errorType?: StructuredEventErrorType;
};
export declare function modelCallResultFromFinishReason(finishReason: string | undefined): 'success' | 'failed' | 'rejected';
