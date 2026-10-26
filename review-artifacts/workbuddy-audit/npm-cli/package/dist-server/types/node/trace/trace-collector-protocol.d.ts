/**
 * Trace Collector Protocol
 *
 * DI Symbol, interface and data types for the in-memory trace collector.
 * The collector receives data from two sources:
 *   1. SDK TracingProcessor — automatic agent/generation/function/handoff spans
 *   2. Hook system — business context enrichment (sessionId, prompt, agent name)
 */
export declare const TraceCollectorService: unique symbol;
export type CollectedSpanType = 'agent' | 'generation' | 'function' | 'handoff' | 'guardrail' | 'response' | 'tool' | 'custom';
export interface CollectedSpan {
    traceId: string;
    spanId: string;
    parentId: string | null;
    name: string;
    type: CollectedSpanType;
    startedAt: string;
    endedAt: string | null;
    duration: number | null;
    status: 'ok' | 'error' | 'cancelled' | 'running';
    error: string | null;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    toolName?: string;
    toolInput?: string;
    toolOutput?: string;
    agentName?: string;
    fromAgent?: string;
    toAgent?: string;
    attributes?: Record<string, any>;
}
export interface CollectedTrace {
    traceId: string;
    name: string;
    sessionId?: string;
    agentName?: string;
    prompt?: string;
    workerPid?: number;
    workerHostname?: string;
    startedAt: string;
    endedAt: string | null;
    duration: number | null;
    status: 'ok' | 'error' | 'cancelled' | 'running';
    spanCount: number;
    totalTokens: number;
    modelInfo?: TraceModelInfo;
    metadata?: Record<string, any>;
}
export type TraceCategory = 'main' | 'auxiliary';
export interface TraceListItem {
    traceId: string;
    name: string;
    category: TraceCategory;
    sessionId?: string;
    agentName?: string;
    prompt?: string;
    startedAt: string;
    endedAt: string | null;
    duration: number | null;
    status: 'ok' | 'error' | 'cancelled' | 'running';
    spanCount: number;
    totalTokens: number;
    modelInfo?: TraceModelInfo;
    /** Number of error spans inside this trace (cancelled spans not counted) */
    errorCount?: number;
    /** Truncated message of the first error span, for preview in list view */
    firstErrorMessage?: string;
    /** Span id of the first error, for jump-to-error in detail view */
    firstErrorSpanId?: string;
    /** Tool/agent name where the first error occurred, used as label */
    firstErrorWhere?: string;
}
export interface TraceBottleneck {
    spanId: string;
    name: string;
    duration: number;
    percentage: number;
}
/** Aggregated error info for a trace, grouped by tool/agent name */
export interface TraceErrorGroup {
    /** toolName / agentName / span.name */
    where: string;
    /** Span type, used to choose icon */
    type: CollectedSpanType;
    /** Number of error spans matching this group */
    count: number;
    /** Truncated error message of the first error in this group */
    sampleMessage: string;
    /** First error span id (for jump-to-span) */
    spanId: string;
}
export interface TraceErrorSummary {
    totalErrors: number;
    /** Aggregated error groups, sorted by count desc */
    groups: TraceErrorGroup[];
    /** First (in time order) error span id; same as groups[0].spanId if present */
    firstErrorSpanId?: string;
}
export interface TraceDetail {
    trace: TraceListItem;
    spans: CollectedSpan[];
    bottleneck: TraceBottleneck | null;
    /** Error aggregation, omitted when totalErrors === 0 */
    errorSummary?: TraceErrorSummary;
}
export interface TraceListResponse {
    traces: TraceListItem[];
    total: number;
}
export interface TraceModelInfo {
    models: string[];
    totalInputTokens: number;
    totalOutputTokens: number;
    /** Cached tokens from last LLM call (for cache hit rate calculation) */
    totalCachedTokens: number;
    /** Input tokens from last LLM call (denominator for cache hit rate) */
    lastCallInputTokens: number;
    callCount: number;
}
export interface TraceListFilters {
    sessionId?: string;
    workerPid?: number;
    /** Filter by trace status. 'error' is the most common use for troubleshooting. */
    status?: 'ok' | 'error' | 'cancelled' | 'running';
}
export interface TraceCollectorService {
    onTraceStart(traceId: string, name: string, metadata?: Record<string, any>): Promise<void>;
    onTraceEnd(traceId: string): Promise<void>;
    onSpanStart(span: Partial<CollectedSpan> & {
        traceId: string;
        spanId: string;
    }): Promise<void>;
    onSpanEnd(spanId: string, updates?: {
        error?: string;
        toolInput?: string;
        toolOutput?: string;
        inputTokens?: number;
        outputTokens?: number;
        model?: string;
    }): Promise<void>;
    enrichTrace(sessionId: string, data: {
        agentName?: string;
        prompt?: string;
        modelInfo?: TraceModelInfo;
    }): Promise<void>;
    enrichSpan(spanId: string, attributes: Record<string, any>): Promise<void>;
    /** Persist the final footer after the STOP hook has completed enrichment. */
    finalizeSession(sessionId: string): Promise<void>;
    /**
     * Record a synthetic cancelled function span on the active trace for `sessionId`.
     * Used by paths that reject a tool call before SDK execution begins (permission
     * rejection, AskUserQuestion / ExitPlanMode cancel), which would otherwise leave
     * no span in the trace.
     *
     * Returns the synthetic span id, or undefined when no trace is active.
     */
    recordCancelledToolSpan(sessionId: string, opts: {
        toolName: string;
        callId?: string;
        toolInput?: unknown;
        errorMessage?: string;
        reason?: 'user_rejected' | 'permission_denied' | 'plan_rejected' | 'ask_cancelled';
    }): string | undefined;
    /**
     * Force-end and persist the running trace bound to `sessionId` (if any) to
     * disk synchronously. Used by abort paths (user reject, ESC cancel, SIGINT)
     * where the SDK would otherwise abandon the trace in memory: `onTraceEnd`
     * is never called → `persistTrace` never runs → the trace (including any
     * cancelled spans recorded just before) is lost when the process exits.
     *
     * If `cancelledTool` is provided, a synthetic cancelled function span is
     * injected before the persist. When NO running trace is bound to the
     * session AND `cancelledTool` is provided, the most recent disk trace is
     * located and patched in place — handles the dominant real-world case
     * where the SDK has already ended the trace (finish_reason=tool_calls)
     * before the user clicks reject.
     *
     * Resolves once the trace file is written. Returns the number of traces
     * actually flushed (0 if nothing applicable was found).
     */
    flushSession(sessionId: string, opts?: {
        /**
         * Cancellation source. Forwarded to the synthetic cancelled span as
         * `attributes.cancel_reason`, so the trace UI can group / filter
         * by source. The four `*_rejected|denied|cancelled` values are the
         * concrete tool-call rejection sources; `aborted` / `shutdown` are
         * generic abort paths used when no specific tool reject is known.
         */
        reason?: 'user_rejected' | 'permission_denied' | 'plan_rejected' | 'ask_cancelled' | 'aborted' | 'shutdown';
        cancelledTool?: {
            toolName: string;
            callId?: string;
            toolInput?: unknown;
            errorMessage?: string;
        };
    }): Promise<number>;
    listTraces(offset?: number, limit?: number, filters?: TraceListFilters): Promise<TraceListResponse>;
    getTraceDetail(traceId: string): Promise<TraceDetail | null>;
    /** Wait for lifecycle/footer writes already accepted by the collector. */
    flushPendingWrites(): Promise<void>;
    clear(): Promise<void>;
}
