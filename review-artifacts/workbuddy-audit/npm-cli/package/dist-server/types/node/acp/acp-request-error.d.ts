import { RequestError } from './acp-sdk-values';
/**
 * ACP JSON-RPC error codes used by this agent.
 *
 * The official SDK reserves a handful of standard values via `RequestError`
 * factory methods (`-32700` parse, `-32603` internal, `-32602` invalid params,
 * `-32000` auth required, `-32002` resource not found). The remaining codes in
 * the `-32099..-32000` range are free for application-defined semantics per the
 * JSON-RPC 2.0 spec, and we use them here to let the frontend pick a precise
 * user-facing message (network vs quota vs model-service vs generic internal).
 *
 * Keep these numbers stable — they are sent over the wire via `_meta`.
 */
export declare const AcpErrorCode: {
    /** Network-level failure (ECONNRESET, timeout, HTTP 5xx gateway). */
    readonly NetworkError: -32001;
    /** Internal error (request cancelled, unexpected state, etc.). */
    readonly InternalError: -32002;
    /** Rate limit / quota exhausted (HTTP 429 or known quota business codes). */
    readonly QuotaExceeded: -32003;
    /** Model service misbehavior (invalid response, malformed tool call, etc.). */
    readonly ModelServiceError: -32004;
};
export declare function createAuthRequiredError(data?: Record<string, unknown>): RequestError;
export declare function classifyErrorAsRequestError(error: unknown): RequestError;
