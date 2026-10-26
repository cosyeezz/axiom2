/**
 * Escape-audit helpers shared by every worker's sandbox audits. A vector is an expression the
 * sandbox evaluates; the probe classifies each result as 'safe', 'blocked' (it threw) or
 * `ESCAPED@<index>` (it reached something that behaves like the host `process`, the sentinel
 * environment variable, or a host Function able to run `return process`).
 */
export interface ProbeRunResult {
    ok: boolean;
    result?: unknown;
    error?: string;
}
/** How to run one piece of code inside the sandbox under audit and read back its return value. */
export type ProbeRunner = (code: string) => Promise<ProbeRunResult>;
export interface EscapeProbeReport {
    results: string[];
    escaped: string[];
    run: ProbeRunResult;
}
export declare const DEFAULT_SENTINEL = "__CBC_WORKER_ESCAPE_AUDIT_SENTINEL__";
export declare const SENTINEL_VALUE = "leaked-secret";
/** Sandbox code that evaluates every vector, each in its own try/catch, and returns the verdicts. */
export declare function escapeProbeSource(vectors: readonly string[], sentinel?: string): string;
/**
 * Runs the vectors with the sentinel set in this process's environment, so a leak of the
 * host env is observable, and reports which vectors escaped.
 */
export declare function runEscapeProbe(run: ProbeRunner, vectors: readonly string[], sentinel?: string): Promise<EscapeProbeReport>;
//# sourceMappingURL=sandbox-probe.d.ts.map