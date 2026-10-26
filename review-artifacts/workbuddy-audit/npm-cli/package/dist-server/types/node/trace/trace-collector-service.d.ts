/**
 * Trace Collector Service — File-persisted trace storage
 *
 * Trace/span lifecycle records are appended to
 * ~/.codebuddy/traces/{pid}/{traceId}.jsonl. Completed span payloads are released
 * after their span_end record is durable; memory retains only active spans and a
 * bounded payload-free index needed by cancellation compatibility paths.
 * List queries consume footer summaries, while detail queries replay JSONL. Legacy
 * whole-file .json snapshots remain readable and patchable.
 */
import { type CollectedSpan, type TraceCollectorService as ITraceCollectorService, type TraceDetail, type TraceListFilters, type TraceListResponse, type TraceModelInfo } from './trace-collector-protocol';
export declare class TraceCollectorServiceImpl implements ITraceCollectorService {
    private readonly logger?;
    private running;
    private activeTraceBySession;
    private writeQueues;
    private pendingPersists;
    private diskPatchQueue;
    /** Always-on log to the Cell logger (or stderr when running in unit tests). */
    private log;
    /**
     * Kill-switch: truthy disables trace collection entirely (no in-memory
     * accumulation, no ~/.codebuddy/projects/.../traces writes). Served
     * processes default it on via server/flag.ts; the cloud trace story is a
     * separate design.
     */
    private isDisabled;
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
    finalizeSession(sessionId: string): Promise<void>;
    /**
     * Record a synthetic cancelled function span for a tool call that was rejected
     * before SDK execution. Without this, permission denial / AskUserQuestion cancel
     * / ExitPlanMode rejection leaves no span in the trace because the SDK never
     * starts a function span and PreToolUse hook never fires.
     *
     * The synthetic span:
     *   - is added to the most recent active trace bound to `sessionId`
     *   - has `type=function`, `status=cancelled`
     *   - reuses the SDK toolCall id when available so it joins the same UI row
     *
     * Returns the span id, or `undefined` when no active trace is bound to the session.
     */
    recordCancelledToolSpan(sessionId: string, opts: {
        toolName: string;
        callId?: string;
        toolInput?: unknown;
        errorMessage?: string;
        reason?: 'user_rejected' | 'permission_denied' | 'plan_rejected' | 'ask_cancelled';
    }): string | undefined;
    /**
     * Force-end and persist the running trace bound to `sessionId`. See protocol
     * doc-comment for the motivating bug (abort path → SDK never calls
     * onTraceEnd → trace + cancelled spans lost).
     *
     * Behavior:
     *   - If no running trace is bound to the session: resolve to 0
     *   - If trace already ended (persistTrace running): await it, return 0
     *   - Otherwise: synthesize an `endedAt` + status (using cancellation
     *     reason hint), then run persistTrace and await it
     */
    flushSession(sessionId: string, opts?: {
        reason?: 'user_rejected' | 'permission_denied' | 'plan_rejected' | 'ask_cancelled' | 'aborted' | 'shutdown';
        cancelledTool?: {
            toolName: string;
            callId?: string;
            toolInput?: unknown;
            errorMessage?: string;
        };
    }): Promise<number>;
    /**
     * Last-resort: when both `running` is empty AND we want to record a
     * cancellation, find the most recent trace file on disk for this session
     * (or the most recent overall, prefer current-pid), append a synthetic
     * cancelled span, and atomically rewrite the file.
     *
     * This handles the dominant real-world case: SDK ends the trace at
     * `finish_reason=tool_calls` (well before the user clicks reject), so the
     * trace is already on disk by the time `recordCancelledToolSpan` runs.
     */
    private patchRecentDiskTrace;
    private patchRecentDiskTraceUnlocked;
    listTraces(offset?: number, limit?: number, filters?: TraceListFilters): Promise<TraceListResponse>;
    getTraceDetail(traceId: string): Promise<TraceDetail | null>;
    flushPendingWrites(): Promise<void>;
    clear(): Promise<void>;
    /**
     * Resolve the running trace bound to a sessionId. Three-step fallback:
     *   1. activeTraceBySession map (set by enrichTrace at USER_PROMPT_SUBMIT)
     *   2. any running trace whose trace.sessionId === sessionId
     *   3. most recently started running trace whose sessionId is still unset
     *
     * @param opts.bindOnFallback when fallback (3) hits, also bind the trace to
     *   this sessionId so subsequent lookups take the fast path. Caller-decides
     *   because flushSession should NOT bind (could move a sibling agent's
     *   orphan trace under the wrong session right before deleting it).
     */
    private findRunningTraceForSession;
    private setSpanPayload;
    private markTraceEnded;
    private finishTrace;
    private observeWrite;
    private appendRecord;
    private appendRecords;
    private readJsonlTrace;
    private rememberSpan;
    private recomputeFirstError;
    private runningListItem;
    private releaseTrace;
}
