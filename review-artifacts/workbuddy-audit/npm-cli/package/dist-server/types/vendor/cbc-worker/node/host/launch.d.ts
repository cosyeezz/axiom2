import type { ResourceLimits, WorkerOptions } from 'node:worker_threads';
/** What a worker needs from the runtime, translated per release line by {@link workerLaunchOptions}. */
export interface WorkerLaunchOptions {
    /**
     * The worker links ES modules with `vm.SourceTextModule`. On the Node line that needs
     * `--experimental-vm-modules` on the worker's own execArgv; Bun has it without flags.
     */
    esm?: boolean;
    /** Extra execArgv appended after the release-line defaults. */
    execArgv?: string[];
    resourceLimits?: ResourceLimits;
    workerData?: unknown;
}
/** execArgv the Node line needs for `vm.SourceTextModule` inside an inline worker. */
export declare const ESM_EXEC_ARGV: readonly string[];
export declare function isBunRuntime(): boolean;
/**
 * Options for `new Worker(source, ...)`: always `eval: true` (the source is a string constant
 * shipped inside the bundle); execArgv only when the worker asked for ESM on the Node line.
 */
export declare function workerLaunchOptions(launch?: WorkerLaunchOptions): WorkerOptions;
//# sourceMappingURL=launch.d.ts.map