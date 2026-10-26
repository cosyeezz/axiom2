/**
 * Recover the HTTP status from whichever shape the SDK threw.
 *
 * `restStatusFor` handles both typed transports — reading `statusCode` off a
 * REST error, and folding a JSON-RPC error's semantic name back through the
 * spec's status table (`TaskNotFoundError` -> 404 and so on). It is called
 * only behind the two type guards because for anything else it answers 500,
 * and a fabricated 500 would read as "the server failed" for what may have
 * been a DNS miss.
 */
export declare function httpStatusOf(err: unknown, message: string): number | undefined;
/**
 * What the remote actually said: the `Response:` tail of the SDK's HTTP error
 * text, or a JSON-RPC error's structured `data`. Absent when the failure
 * produced no body.
 */
export declare function responseBodyOf(err: unknown, message: string): string | undefined;
