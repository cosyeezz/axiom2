/**
 * Extract tool-specific attributes based on tool name and input.
 *
 * Follows OpenAI semantic conventions style (e.g. function.input, function.output).
 * Each tool records its most meaningful attributes for tracing and debugging.
 */
export declare function extractToolInputAttributes(toolName: string, toolInput: any): Record<string, any>;
