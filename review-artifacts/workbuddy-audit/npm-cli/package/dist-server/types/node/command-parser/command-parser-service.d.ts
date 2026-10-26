/**
 * Command Parser Service Implementation
 *
 * Provides shell command parsing using a tiered strategy approach:
 * 1. tree-sitter-bash for accurate AST parsing (when available)
 * 2. shell-quote for token-based parsing (handles quotes/escapes)
 * 3. regex for basic fallback
 */
import { CommandParserService, ExtractedCommand } from './command-parser-protocol';
export declare class CommandParserServiceImpl implements CommandParserService {
    private strategies;
    private lazyInitKicked;
    protected collectStrategies(): void;
    extractCommands(commandString: string): ExtractedCommand[];
}
/**
 * Get the singleton CommandParserService instance
 *
 * @deprecated Use dependency injection with ContainerUtil.get(CommandParserService) instead
 */
export declare function getCommandParserService(): CommandParserService;
/**
 * Extract commands from a command string (convenience function)
 *
 * @deprecated Use CommandParserService.extractCommands directly
 * @param commandString The shell command string to parse
 * @returns Array of extracted commands
 */
export declare function extractCommands(commandString: string): ExtractedCommand[];
