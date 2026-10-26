export type McpToolProgressCallback = (progress: number, total?: number, message?: string) => void;
export type McpResultMetaSink = (result: Record<string, unknown> & {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    isError?: boolean;
}) => void;
export interface McpCallSideband {
    onProgress?: McpToolProgressCallback;
    resultMetaSink?: McpResultMetaSink;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
    realMeta?: Record<string, unknown>;
}
/**
 * Split local `__*` sideband fields from the open MCP wire metadata. Known
 * sidebands are returned to the caller; every `__*` key is kept off the wire.
 */
export declare function extractMcpCallSideband(meta: Record<string, unknown> | null | undefined): McpCallSideband;
/** 保留原始未知字段，并用 schema 解析值覆盖标准字段。 */
export declare function emitMcpToolResultSideband(rawResponse: unknown, parsed: Record<string, unknown> & {
    content?: unknown[];
    structuredContent?: Record<string, unknown>;
    _meta?: Record<string, unknown>;
    isError?: boolean;
}, sink?: McpResultMetaSink): void;
