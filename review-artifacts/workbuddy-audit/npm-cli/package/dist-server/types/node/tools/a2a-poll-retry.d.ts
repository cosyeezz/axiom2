/**
 * Retry policy for a FAILED `tasks/get` REQUEST — distinct from
 * `A2APollPolicy`, which governs the cadence of SUCCESSFUL polls. A request
 * that never produced a task snapshot is retried on this schedule; a request
 * that did is subject to the poll interval instead.
 *
 * Fixed rather than env-overridable: the poll interval and the overall budget
 * are the two knobs a host has a legitimate reason to tune, and every extra
 * one is a way to misconfigure the loop into a request storm.
 */
export declare const POLL_RETRY_MAX_ATTEMPTS = 5;
export declare const POLL_RETRY_BASE_INTERVAL_MS = 1000;
export declare const POLL_RETRY_BACKOFF_MULTIPLIER = 1.5;
export interface PollFailureClassification {
    /**
     * The HTTP status behind this failure, when one could be established.
     * Absent for transport failures that never got a response at all (DNS,
     * connection reset, the client's own timeout) — deliberately not defaulted
     * to 500, so the model is never told a status the wire did not carry.
     */
    httpStatus?: number;
    /** Whether the poll loop should retry rather than give up. */
    retryable: boolean;
    /** The SDK's error text, verbatim. */
    message: string;
    /**
     * What the remote actually said: the `Response:` tail of the SDK's HTTP
     * error text, or a JSON-RPC error's structured `data`. Absent when the
     * failure produced no body.
     */
    responseBody?: string;
}
/**
 * Decide whether a failed `tasks/get` request is worth retrying, and pull out
 * the detail the model needs either way.
 *
 * Knows nothing about aborts on purpose. A user cancel and the client's own
 * 120s request timeout reach this function as the SAME error text (see
 * `A2aClientService.withAbortAndClient`), so only the caller — which can read
 * `session.abortSignal` — can tell them apart. This classifies the timeout
 * reading of that message (retryable) and leaves the cancel reading to the
 * poll loop.
 */
export declare function classifyPollFailure(err: unknown): PollFailureClassification;
/** Wait before the `retryIndex`-th (0-based) retry: 1s, 1.5s, 2.25s, 3.375s, 5.0625s. */
export declare function pollRetryDelayMs(retryIndex: number): number;
