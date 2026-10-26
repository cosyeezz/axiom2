/**
 * Windows command exit code semantic interpretation.
 *
 * Some Windows commands use non-zero exit codes for non-error conditions.
 * Without this mapping, the model (and user) would interpret any non-zero
 * exit code as a failure, leading to unnecessary retries.
 *
 * Reference: Claude Code's commandSemantics.ts
 */
export interface CommandSemantic {
    /** Whether this exit code represents an actual error */
    isError: boolean;
    /** Human-readable explanation of the exit code */
    message?: string;
}
/**
 * Interpret the exit code of a command, accounting for Windows-specific semantics.
 *
 * @param command - The original command string
 * @param exitCode - The process exit code
 * @returns Semantic interpretation, or null if no special handling needed
 */
export declare function interpretCommandResult(command: string, exitCode: number | null): CommandSemantic | null;
