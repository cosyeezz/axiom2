import { type ArtifactDeclarationOutcome } from './produced-artifact';
/** Environment variable naming the report file for the current command. */
export declare const ARTIFACT_REPORT_ENV = "CODEBUDDY_ARTIFACTS";
export interface ArtifactReportLogger {
    debug?: (message: string) => void;
}
/**
 * Create this command's report file path and record it on `env`.
 *
 * The name carries pid, timestamp and a random suffix rather than the tool
 * call id. Concurrent commands are isolated either way, but a call id
 * originates from `details.toolCall.callId` — model-influenced input, which
 * would need traversal checks before being spliced into a path. Random naming
 * has no such exposure.
 *
 * Returns `undefined` when the directory cannot be created; callers treat that
 * as "no channel this run" rather than failing the command, since a command
 * that produces no artifacts is by far the common case.
 */
export declare function ensureArtifactReportPath(env: Record<string, string>): string | undefined;
/**
 * Read and delete this command's report file.
 *
 * Deletion happens even when parsing fails, so a stale file cannot leak into a
 * later command that happens to draw the same path.
 */
export declare function readArtifactReport(reportPath: string | undefined, logger?: ArtifactReportLogger): ArtifactDeclarationOutcome;
/**
 * Drop the report file without reading it.
 *
 * Used when a run is voided and retried — sandbox escalation reruns the whole
 * command, and the abandoned attempt's declarations must not survive into the
 * result. The script re-appends on the retry, since `>>` recreates the file.
 */
export declare function discardArtifactReport(reportPath: string | undefined): void;
