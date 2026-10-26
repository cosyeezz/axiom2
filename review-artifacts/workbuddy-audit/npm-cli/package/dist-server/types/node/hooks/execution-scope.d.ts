import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChildProcess } from 'node:child_process';
/** Execution ownership supplied by the embedded Agent; hook semantics stay in the original components. */
export interface HookExecutionScope {
    readonly environment: NodeJS.ProcessEnv;
    readonly signal: AbortSignal;
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
    readonly proxyUrl: () => Promise<string>;
    readonly onSpawn: (child: ChildProcess) => void;
    readonly runOneTime: (agent: string, input: string) => Promise<string>;
}
export declare const hookExecutionScope: AsyncLocalStorage<HookExecutionScope>;
/**
 * The environment one hook event's commands start from: this runtime's
 * environment with the session's shell environment policy above it.
 */
export declare const hookEventEnvironment: AsyncLocalStorage<NodeJS.ProcessEnv>;
