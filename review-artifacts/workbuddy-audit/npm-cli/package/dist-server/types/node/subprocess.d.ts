import { type ChildProcess } from 'node:child_process';
/** An unref'ed process with file-based output. Windows Job ownership is retained. */
export interface DetachedProcess extends Pick<ChildProcess, 'exitCode' | 'kill' | 'unref'> {
    readonly pid: number;
    on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
    once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}
export interface SpawnDetachedOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /** Append stdout/stderr to this file; otherwise discard output. */
    logPath?: string;
    shell?: boolean;
    /** Already-open one-shot handoff descriptors, starting at fd 3; never serialized to argv/env. */
    extraStdio?: readonly number[];
}
/** Detach from the terminal/event loop, not the Windows lifetime Job. */
export declare function spawnDetached(command: string, args?: readonly string[], options?: SpawnDetachedOptions): Promise<DetachedProcess>;
/** Only daemon workers may outlive the Windows CLI that requests them. */
export declare function spawnDaemon(command: string, args: readonly string[], options: SpawnDetachedOptions): Promise<{
    pid: number;
}>;
