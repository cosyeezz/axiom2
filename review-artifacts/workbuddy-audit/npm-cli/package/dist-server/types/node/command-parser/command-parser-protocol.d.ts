/**
 * Command Parser Protocol
 *
 * Defines interfaces and symbols for the command parsing service.
 * This module enables parsing complex shell commands and extracting
 * individual commands from them for permission rule matching.
 */
/**
 * Represents an extracted command from a shell command string
 */
export interface ExtractedCommand {
    /** The command name (e.g., "git", "npm", "cd") */
    command: string;
    /** The command arguments */
    args: string[];
    /** The full command string (command + args) */
    fullCommand: string;
}
/**
 * Parsing strategy identifier
 */
export type ParsingStrategy = 'tree-sitter' | 'shell-quote' | 'regex';
/**
 * Command Parser Service
 *
 * Main service for parsing shell commands. Uses a tiered strategy:
 * 1. tree-sitter-bash for accurate AST parsing (when available)
 * 2. shell-quote for token-based parsing (handles quotes/escapes)
 * 3. regex for basic fallback
 */
export declare const CommandParserService: unique symbol;
export interface CommandParserService {
    /**
     * Extract all commands from a command string
     *
     * This is the main entry point for command extraction.
     * Uses the best available parsing strategy.
     *
     * @param commandString The shell command string to parse
     * @returns Array of extracted commands
     */
    extractCommands(commandString: string): ExtractedCommand[];
}
/**
 * Command Parser Strategy
 *
 * Interface for parsing strategy implementations.
 * Each strategy provides a different method for extracting commands.
 */
export declare const CommandParserStrategy: unique symbol;
export interface CommandParserStrategy {
    /**
     * Strategy name/identifier
     */
    readonly name: ParsingStrategy;
    /**
     * Priority of this strategy (higher = preferred)
     */
    readonly priority: number;
    /**
     * Check if this strategy is available
     */
    isAvailable(): boolean;
    /**
     * Extract commands using this strategy
     *
     * @param commandString The shell command string to parse
     * @returns Array of extracted commands, or null if parsing failed
     */
    extractCommands(commandString: string): ExtractedCommand[] | null;
    /**
     * Kick off (idempotent) lazy initialization for strategies that need to
     * load heavy resources (e.g. tree-sitter WASM) before becoming available.
     *
     * Optional: strategies that are always synchronously available (shell-quote,
     * regex) do not implement it. The service invokes it fire-and-forget on the
     * first `extractCommands` call, so the heavy resource is only paid for when
     * command parsing is actually needed — not eagerly at container assembly.
     */
    ensureInitialized?(): Promise<void>;
}
