/** Model endpoint URLs: a configured URL normalized to one API path (`/chat/completions`, `/responses`). */
/** `url` without query, hash, trailing slashes or trailing `endpoint` paths, e.g. an SDK base URL. */
export declare function stripEndpointPath(url: string, endpoint: string): string;
/** `url` ending in exactly one `endpoint` path, query and hash kept; idempotent. */
export declare function withEndpointPath(url: string, endpoint: string): string;
