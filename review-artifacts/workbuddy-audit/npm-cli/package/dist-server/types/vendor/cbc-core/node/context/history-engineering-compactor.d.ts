/**
 * History Engineering Compactor
 *
 * A purely deterministic, rule-based compressor that reduces conversation history
 * to a structured XML summary WITHOUT any LLM calls.
 *
 * Design principles:
 * 1. Zero LLM dependency - uses only string manipulation and pattern matching
 * 2. Preserves critical information - file paths, tool results, code snippets
 * 3. Structured output - uses XML tags for machine-readable compressed history
 * 4. Incremental - can build on previous compact results
 */
export interface EngineeringCompactResult {
    /** The compressed content wrapped in <cb_summary> tags */
    compactContent: string;
    /** Estimated token count of the compressed content */
    estimatedTokens: number;
    /** Number of original history items that were processed */
    originalItemCount: number;
}
export declare class HistoryEngineeringCompactor {
    /**
     * Compact the given history into a structured summary.
     *
     * @param history - The conversation history to compact
     * @returns EngineeringCompactResult with the compressed content
     */
    static compact(history: any[]): EngineeringCompactResult;
    /**
     * Generate the summary header text.
     */
    private static generateSummaryHeader;
    /**
     * Strip the summary header from inner content, preserving all structured tags.
     *
     * The header is any free-form text that precedes the first meaningful structural tag
     * (e.g. <conversation_history_summary>, <previous_*, <analysis>, <summary>).
     * We locate the first such tag and return everything from there onward.
     * If no structural tag is found, return the content as-is.
     */
    private static stripSummaryHeader;
    /**
     * Generate compressed content from a list of conversation items.
     */
    private static generateCompressedContent;
    /**
     * Compress a user message into structured format.
     */
    private static compressUserMessage;
    /**
     * Compress an assistant message into structured format.
     * Handles both text content and embedded tool_calls.
     */
    private static compressAssistantMessage;
    /**
     * Compress a function_call type item.
     */
    private static compressFunctionCallItem;
    /**
     * Extract text content from a user message (handles both string and array content).
     */
    private static extractTextFromUserMessage;
    /**
     * Process tool arguments: replace 'content' field with 'omitted' to avoid large payloads.
     * Aligned with default-compact-strategy.processToolArguments.
     */
    private static processToolArguments;
    /**
     * Estimate token count for a given text (rough approximation: ~4 chars per token).
     */
    private static estimateTokens;
}
//# sourceMappingURL=history-engineering-compactor.d.ts.map