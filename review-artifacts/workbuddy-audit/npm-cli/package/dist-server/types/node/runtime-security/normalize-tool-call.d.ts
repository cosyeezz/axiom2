export interface NormalizedToolCall {
    toolName: string;
    toolInput: Record<string, unknown>;
}
export declare function normalizeToolCall(toolName: string, toolInput: Record<string, unknown> | undefined): NormalizedToolCall;
