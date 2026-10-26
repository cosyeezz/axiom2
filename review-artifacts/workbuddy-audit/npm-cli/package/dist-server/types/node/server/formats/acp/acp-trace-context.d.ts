export declare function isValidW3CTracestate(value: unknown): value is string;
export declare function isValidW3CBaggage(value: unknown): value is string;
export interface AcpTraceContext {
    traceparent: string;
    tracestate?: string;
    baggage?: string;
}
export interface AcpTraceContextSource {
    lastConversationTraceparent?: string;
    upstreamTracestate?: string;
    upstreamBaggage?: string;
    conversationRequestRootSpan?: {
        traceId?: string;
        requestHeaders?: Record<string, string>;
    };
}
/**
 * Reads the ACP canonical W3C fields first, then the two historical CodeBuddy
 * layouts. A legacy traceId/parentSpanId pair is upgraded to traceparent.
 */
export declare function readAcpTraceContext(meta: unknown, options?: {
    includeLegacy?: boolean;
}): AcpTraceContext | undefined;
/** Transitional reader for telemetry that historically received a bare traceId. */
export declare function readAcpTraceId(meta: unknown): string | undefined;
export declare function getSessionAcpTraceContext(source: AcpTraceContextSource | undefined): AcpTraceContext | undefined;
/**
 * Removes legacy CodeBuddy tracing keys and writes only ACP's root W3C keys.
 * Other vendor metadata is preserved.
 */
export declare function withCanonicalAcpTraceContext(meta: Record<string, unknown> | undefined, traceContext: Partial<AcpTraceContext> | undefined): Record<string, unknown>;
/** Retains the completed request's display ID without making its span a replay parent. */
export declare function withAcpReplayTraceMeta(meta: Record<string, unknown> | undefined): Record<string, unknown>;
