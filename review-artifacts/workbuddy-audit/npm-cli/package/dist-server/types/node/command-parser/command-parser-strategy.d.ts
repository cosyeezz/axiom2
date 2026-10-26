/**
 * Command Parser Strategies
 *
 * Three parsing strategies with different capabilities and priorities:
 * - TreeSitterParserStrategy: Full AST parsing via a pure-TS bash parser (highest priority)
 * - ShellQuoteParserStrategy: Token-based parsing
 * - RegexParserStrategy: Basic fallback (always available)
 */
import { CommandParserStrategy, ExtractedCommand } from './command-parser-protocol';
/**
 * Regex Parser Strategy
 *
 * Basic fallback strategy that uses regex to split commands.
 * This is the least accurate but most reliable fallback.
 */
export declare class RegexParserStrategy implements CommandParserStrategy {
    readonly name: "regex";
    readonly priority = 1;
    isAvailable(): boolean;
    extractCommands(commandString: string): ExtractedCommand[];
}
/**
 * Shell Quote Parser Strategy
 *
 * Token-based parsing using the shell-quote library.
 * Good fallback that handles quotes and escapes correctly.
 */
export declare class ShellQuoteParserStrategy implements CommandParserStrategy {
    readonly name: "shell-quote";
    readonly priority = 2;
    isAvailable(): boolean;
    extractCommands(commandString: string): ExtractedCommand[] | null;
    private isOperator;
    private getOperatorString;
    private buildCommand;
}
/**
 * Highest-priority parsing strategy. Produces a tree-sitter-bash-compatible AST
 * via a **pure-TypeScript** bash parser (`bash-ts-parser.ts`) instead of
 * `web-tree-sitter` + `tree-sitter-bash.wasm`.
 *
 * Why pure-TS: the WASM parser cost a ~32MB Emscripten linear-memory heap
 * (`Parser.init` + `Language.load`) plus wasm-file distribution, for the sole
 * purpose of splitting a Bash command into sub-commands for permission matching
 * (`permission-utils.ts` → `CommandParserService`). Claude Code does the same
 * thing with a pure-TS parser (its `bashParser.ts`, `ensureParserInitialized`
 * is a no-op). Measured: pure-TS parse is ~40% faster than the WASM parser on
 * short commands (no JS↔WASM marshalling / full-AST build overhead) AND removes
 * the ~32MB WASM heap. The consuming AST-walk below is unchanged: `BashNode`
 * exposes the same members (`type`/`text`/`child`/`childCount`/`namedChild`/
 * `namedChildCount`/`hasError`) this strategy already relied on.
 */
export declare class TreeSitterParserStrategy implements CommandParserStrategy {
    readonly name: "tree-sitter";
    readonly priority = 3;
    /** Pure-TS parser needs no async init; always available. */
    isAvailable(): boolean;
    /** No-op: kept for API compatibility (service invokes it fire-and-forget). */
    ensureInitialized(): Promise<void>;
    extractCommands(commandString: string): ExtractedCommand[] | null;
    private traverseAndExtract;
    private extractCommandInfo;
    private isArgument;
    private extractArgumentValue;
    private extractPipeline;
    private extractList;
    private extractRedirected;
    private hasErrors;
}
