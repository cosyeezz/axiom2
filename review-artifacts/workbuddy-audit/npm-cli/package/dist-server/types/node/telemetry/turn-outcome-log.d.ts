import { type StructuredEventLogger, type StructuredEventRecord, type StructuredEventResult, type StructuredObservationRecord } from '../../vendor/cbc-shared/node/index.js';
import type { ResultMessage } from '../cli/stream-json-protocol';
export declare const AGENT_TURN_RECEIVED_EVENT = "agent.turn.received";
export declare const AGENT_TURN_COMPLETED_EVENT = "agent.turn.completed";
type TurnReceivedFields = Record<never, never>;
interface TurnCompletedFields {
    terminal_reason?: string;
    input_tokens?: number;
    output_tokens?: number;
    cached_read_tokens?: number;
    cached_write_tokens?: number;
    total_cost_usd?: number;
}
export declare function logAgentTurnReceived(input: {
    logger: Pick<StructuredEventLogger, 'info'>;
    conversationId?: string;
    conversationRequestId: string;
    traceId?: string;
}): StructuredObservationRecord<TurnReceivedFields> | undefined;
export declare function logAgentTurnDispatchFailure(input: {
    logger: StructuredEventLogger;
    conversationId?: string;
    conversationRequestId: string;
    traceId?: string;
    startedAt: number;
    error: unknown;
}): StructuredEventRecord<TurnCompletedFields> | undefined;
export declare function logAgentTurnCompleted(input: {
    logger: StructuredEventLogger;
    message: ResultMessage;
    conversationRequestId?: string;
    traceId?: string;
    result?: StructuredEventResult;
}): StructuredEventRecord<TurnCompletedFields> | undefined;
export {};
