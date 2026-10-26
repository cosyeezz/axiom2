import { Logger } from '@celljs/core';
/**
 * Symbol for dependency injection
 */
export declare const ToolResultBlobService: unique symbol;
/**
 * Reference object for a previously externalized tool result (reserved for future use).
 */
export interface ToolResultRef {
    type: 'tool_result_ref';
    /** Original content size in bytes */
    size: number;
    /** Full path to the persisted output file */
    filePath: string;
}
/**
 * Service interface for externalizing large tool results to disk.
 *
 * Follows the Claude Code pattern: when a tool result exceeds a size threshold,
 * the full output is saved to a file under `~/.codebuddy/tool-results/{sessionDir}/`,
 * and the in-memory/persisted history stores only a `<persisted-output>` placeholder
 * with a preview of the first 2KB.
 *
 * This prevents unbounded memory growth in long-running monorepo sessions where
 * tools like Grep/Read/TaskOutput can return very large outputs.
 */
export interface ToolResultBlobService {
    /**
     * Check if a tool result output should be externalized based on size.
     * @param output The tool result output string
     * @returns true if the output exceeds the externalization threshold
     */
    shouldExternalize(output: string): boolean;
    /**
     * Save a large tool result to disk and return the placeholder text
     * that should be stored in the history instead.
     *
     * @param callId The tool_use_id (e.g., "call_00_abc123")
     * @param output The full tool result output
     * @param sessionStoreId The session's storeId (used for directory naming)
     * @param parentSessionId Optional parent session ID (for subagents)
     * @returns The placeholder text to store in history
     */
    externalize(callId: string, output: string, sessionStoreId: string, parentSessionId?: string): Promise<string>;
    /**
     * Read back a previously externalized tool result.
     * @param filePath Path to the persisted output file
     * @returns The original full content, or undefined if file is missing
     */
    read(filePath: string): Promise<string | undefined>;
    /**
     * Clean up all externalized tool results for a session.
     * @param sessionStoreId The session's storeId
     * @param parentSessionId Optional parent session ID (for subagents)
     */
    cleanupSession(sessionStoreId: string, parentSessionId?: string): Promise<void>;
    /**
     * Get the file path where a tool result's full output would be spilled to disk.
     * Used by tools (e.g., BashTool) to create an OutputSpiller that streams
     * full output to this path before truncation happens.
     */
    getSpillFilePath(callId: string, sessionStoreId: string, parentSessionId?: string): string;
    /**
     * Create an externalization placeholder for a tool result whose full output
     * has already been written to disk by an OutputSpiller.
     * Unlike externalize(), this does NOT write the file — it only generates the placeholder.
     *
     * @param callId The tool_use_id
     * @param totalBytes Total bytes written to the spill file
     * @param spillFilePath Path to the existing spill file
     * @param truncatedOutput The truncated output text (used for preview)
     * @returns The placeholder text to store in history
     */
    externalizeFromSpillFile(callId: string, totalBytes: number, spillFilePath: string, truncatedOutput: string): string;
}
export declare class ToolResultBlobServiceImpl implements ToolResultBlobService {
    protected readonly logger: Logger;
    init(): void;
    shouldExternalize(output: string): boolean;
    /**
     * Save a large tool result to disk and return the placeholder text
     * that should be stored in the history instead.
     *
     * @param callId The tool_use_id (e.g., "call_00_abc123")
     * @param output The full tool result output
     * @param sessionStoreId The session's storeId (used for directory naming)
     * @param parentSessionId Optional parent session ID (for subagents)
     * @returns The placeholder text to store in history
     */
    externalize(callId: string, output: string, sessionStoreId: string, parentSessionId?: string): Promise<string>;
    read(filePath: string): Promise<string | undefined>;
    getSpillFilePath(callId: string, sessionStoreId: string, parentSessionId?: string): string;
    externalizeFromSpillFile(callId: string, totalBytes: number, spillFilePath: string, truncatedOutput: string): string;
    cleanupSession(sessionStoreId: string, parentSessionId?: string): Promise<void>;
    /**
     * Get the directory for storing tool results for a specific session.
     *
     * For main sessions: ~/.codebuddy/projects/{projectId}/{sessionId}/tool-results/
     * For subagents: ~/.codebuddy/projects/{projectId}/{parentSessionId}/subagents/{storeId}/tool-results/
     *
     * This mirrors the session history file layout:
     *   {sessionId}.jsonl          ← main session history
     *   {sessionId}/tool-results/  ← main session tool results
     *   {parentSessionId}/subagents/
     *     ├── agent-xxx.jsonl      ← subagent history
     *     └── agent-xxx/tool-results/ ← subagent tool results
     */
    private getSessionToolResultDir;
}
