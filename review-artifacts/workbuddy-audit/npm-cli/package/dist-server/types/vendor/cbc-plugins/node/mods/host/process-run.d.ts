import { HooksError } from '../engine/hooks-error';
import type { ProcessRunInit, ProcessRunResult } from '../types';
/** 官方语义：缺省 30 s，最长十分钟。 */
export declare const PROCESS_DEFAULT_TIMEOUT_MS = 30000;
export declare const PROCESS_MAX_TIMEOUT_MS: number;
/** 每路输出最多交回的字节数（官方 process-host OUTPUT_LIMIT），超出部分静默丢弃。 */
export declare const PROCESS_OUTPUT_LIMIT_BYTES: number;
/**
 * `$.process.run` 无法给出结果时的拒绝。core 把它转成 `{ deny }`，mod 侧得到一个
 * 可 catch 的异常 —— 与官方「命令起不来或到点还在跑就 reject」一致。
 */
export declare class ProcessRunRefusal extends HooksError {
}
/**
 * git 一律关掉仓库自带的 hooks 与 fsmonitor：那是工作区里的可执行配置，mod 跑一次
 * `git status` 不该顺带执行仓库作者写的命令。
 */
export declare function argvOf(argv: readonly string[]): readonly string[];
/**
 * 按 argv 起子进程（不经 shell），读完全部输出后给出 `{ exitCode, stdout, stderr }`。
 *
 * - 任何退出码都是结果，不是错误；被信号结束记 1（官方 `ProcessRunResult.exitCode`）。
 * - 起不来（如 ENOENT）、超时、宿主 signal 中止 → `ProcessRunRefusal`。
 * - `init.env` 叠加在宿主环境之上，而不是替换它（否则连 `PATH` 都丢了）。
 */
export declare function runProcess(argv: readonly string[], init: ProcessRunInit | undefined, cwd: string, signal?: AbortSignal): Promise<ProcessRunResult>;
/**
 * Official `$.process.spawn`: starts `argv` (no shell) and streams what it writes,
 * piece by piece (`{ stream, text }`), then answers `{ value: { code, signal } }`.
 *
 * The loop is the child's life: leaving it (`return()`), `signal` aborting, or the
 * caller dropping it kills the child. A child that cannot start rejects the first pull.
 * Nothing is dropped: past the backlog the child's pipes are paused until the loop pulls.
 */
export declare function spawnProcess(request: {
    argv?: unknown;
    cwd?: unknown;
    env?: unknown;
    input?: unknown;
}, cwd: string, signal?: AbortSignal): AsyncGenerator<{
    stream: 'stdout' | 'stderr';
    text: string;
}, {
    value: {
        code: number | null;
        signal: string | null;
    };
}>;
//# sourceMappingURL=process-run.d.ts.map