export type StructuredEventResult = 'success' | 'failed' | 'rejected' | 'cancelled';
export type StructuredEventErrorType = 'cancelled' | 'timeout' | 'decode' | 'unknown';
export type StructuredEventValue = string | number | boolean;
export type StructuredEventFields = object;
export interface StructuredEventLogger {
    info(message: string): void;
    warn?(message: string): void;
    error(message: string): void;
}
export interface StructuredEventCorrelation {
    request_id?: string;
    trace_id?: string;
    user_id?: string;
    enterprise_id?: string;
    conversation_id?: string;
    conversation_request_id?: string;
    conversation_message_id?: string;
    task_id?: string;
    runtime_id?: string;
    session_id?: string;
    call_id?: string;
}
export interface StructuredEventBaseRecord extends StructuredEventCorrelation {
    event_id: string;
    event_name: string;
    service: string;
    msg: string;
    result: StructuredEventResult;
    duration_ms: number;
    stage?: string;
    stop_reason?: 'cancelled';
    error_code?: string;
    error_type?: StructuredEventErrorType;
    error_summary_omitted?: true;
    raw?: string;
}
export interface StructuredObservationBaseRecord extends StructuredEventCorrelation {
    event_id: string;
    event_name: string;
    service: string;
    msg: string;
    stage?: string;
    raw?: string;
}
type ReservedEventField = keyof StructuredEventBaseRecord;
type BusinessEventFields<T extends StructuredEventFields> = {
    [K in keyof T]: T[K] extends StructuredEventValue | undefined ? T[K] : never;
} & Partial<Record<ReservedEventField, never>>;
export type StructuredEventRecord<T extends StructuredEventFields = Record<string, StructuredEventValue | undefined>> = StructuredEventBaseRecord & T;
export interface StructuredEventInput<T extends StructuredEventFields> {
    logger: StructuredEventLogger;
    eventName: string;
    service: string;
    message: string;
    result: StructuredEventResult;
    startedAt: number;
    stage?: string;
    correlation?: StructuredEventCorrelation;
    fields: BusinessEventFields<T>;
    raw?: string | ((durationMs: number) => string);
    rejectedLevel?: 'info' | 'warn';
    error?: unknown;
    errorCode?: string;
    errorType?: StructuredEventErrorType;
}
type ReservedObservationField = keyof StructuredObservationBaseRecord;
type BusinessObservationFields<T extends StructuredEventFields> = {
    [K in keyof T]: T[K] extends StructuredEventValue | undefined ? T[K] : never;
} & Partial<Record<ReservedObservationField | 'result' | 'duration_ms', never>>;
export type StructuredObservationRecord<T extends StructuredEventFields = Record<string, StructuredEventValue | undefined>> = StructuredObservationBaseRecord & T;
export interface StructuredObservationInput<T extends StructuredEventFields> {
    logger: Pick<StructuredEventLogger, 'info'>;
    eventName: string;
    service: string;
    message: string;
    stage?: string;
    correlation?: StructuredEventCorrelation;
    fields: BusinessObservationFields<T>;
    raw?: string;
}
/** Emits a non-terminal structured fact without weakening the terminal result contract. */
export declare function logStructuredObservation<T extends StructuredEventFields>(input: StructuredObservationInput<T>): StructuredObservationRecord<T> | undefined;
/**
 * Emits one JSON terminal event through the caller's existing logger.
 * Business domains own typed adapters and fixed field names; this shared layer
 * only owns the common event contract and safe error diagnosis.
 */
export declare function logStructuredEvent<T extends StructuredEventFields>(input: StructuredEventInput<T>): StructuredEventRecord<T> | undefined;
export {};
//# sourceMappingURL=structured-event-log.d.ts.map