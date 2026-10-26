import { Readable } from 'node:stream';
export interface ResponsesEarlyError {
    /** HTTP status the failure would have had on a plain JSON endpoint. */
    status: number;
    /** OpenAI error body: `{"error": {...}}`. */
    body: string;
}
export interface ResponsesStreamStart {
    /** Stream to hand to the consumer: the source with buffered bytes replayed first. */
    stream: Readable;
    earlyError?: ResponsesEarlyError;
}
/** 标记由 200 流内早期错误合成的 HTTP 错误。 */
export declare const RESPONSES_STREAM_EARLY_ERROR = "__responsesStreamEarlyError";
export declare function isResponsesStreamEarlyError(error: unknown): boolean;
/** The HTTP-equivalent failure carried by an early event, if it is one we can map. */
export declare function earlyErrorOf(event: Record<string, any>): ResponsesEarlyError | undefined;
/**
 * `signal` stops the peek: axios (0.26) drops its abort listener once headers arrive,
 * so a stop while waiting for the first decisive event would otherwise go unnoticed.
 */
export declare function peekResponsesStreamStart(source: Readable, signal?: AbortSignal): Promise<ResponsesStreamStart>;
/** Axios-shaped HTTP error for an early failure, so retry and error analysis treat it natively. */
export declare function toEarlyResponsesAxiosError(early: ResponsesEarlyError, response: {
    headers?: unknown;
}, config: unknown): Error;
