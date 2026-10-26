import { Logger } from '@celljs/core';
import { Workspace } from '@genie/runtime';
import type { IPty } from '@lydell/node-pty';
import type { Terminal } from '@xterm/headless';
import { ChildProcess } from 'child_process';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { SettingsManager } from '../settings/settings-protocol';
import { ShellExecuteParams, ShellExecutionHandle, ShellResult, ShellService, ShellSpecialKey } from './shell-protocol';
import { ShellSnapshotService } from './shell-snapshot-protocol';
import { type AnsiOutput } from './terminal-serializer';
/**
 * 进程是否仍然存在。`process.kill(pid, 0)` 不发信号，只做存在性探测。
 *
 * 失败原因必须分开看：
 * - `ESRCH` —— 进程确实不在了。
 * - `EPERM` —— 进程在，只是当前用户无权给它发信号（换 uid 的 sudo 子进程等）。
 *
 * 旧实现把两者都当成"已退出"，代价有两个：`kill()` 会对一个还活着的进程提前放弃，
 * 而存活对账会把它误判成终态并给模型发一条假的完成通知。因此除 `ESRCH` 之外的
 * 任何错误都按"存在"处理——宁可多等一轮，也不要误报终态。
 *
 * 注意 `!pid` 这道守卫是承重的：pid 0 在 POSIX 里指"调用者自己的进程组"，
 * `process.kill(0, 0)` 会成功，后续的 `process.kill(-pid, ...)` 会把信号发给我们自己。
 */
export declare function processExists(pid: number): boolean;
/**
 * 进程是否已终止：不存在（`ESRCH`），或存在但已是僵尸。
 *
 * 这是"还有没有终止事件可等"的判据，供 `settleIfProcessExited` 与后台任务的
 * 存活对账使用。它与 `isAlive` 刻意分开：`isAlive` 服务于"该不该发信号"，
 * 把僵尸语义塞进去会波及 grep 等既有调用方。
 */
export declare function isProcessTerminated(pid: number): boolean;
export declare function resolveWindowsHideOption(isWin: boolean): {
    windowsHide?: true;
};
export declare function buildChildProcessEnv(params: {
    extraEnv: Record<string, string | undefined>;
    shellRuntimeEnv: Record<string, string | undefined>;
    rawCommand?: boolean;
    sandboxBypass?: boolean;
    processEnv?: NodeJS.ProcessEnv;
    isWin?: boolean;
    projectDir?: string;
    session?: ShellExecuteParams['session'];
    carrier?: Readonly<Record<string, unknown>>;
}): Record<string, string | undefined>;
export { wrapPowerShellCommandWithSafeDelete } from './powershell-safe-delete';
export declare class ShellServiceImpl implements ShellService {
    protected readonly workspace: Workspace;
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly snapshotService?: ShellSnapshotService;
    protected readonly prewarmState?: IPrewarmStateService;
    private readonly activeHandles;
    private snapshotWarmupTimer?;
    private snapshotWarmupScheduled;
    private snapshotWarmupActivationRegistered;
    private snapshotWarmupDisposed;
    init(): void;
    disposeSnapshotWarmup(): void;
    /**
     * In library runtime, when a session's residency starts: its own snapshot,
     * under the conditions the process warmup has.
     */
    warmupSessionSnapshot(sessionId: string): void;
    /**
     * 调度 snapshot 预热
     *
     * 启动路径只做最轻量的调度: 排一个 2s 定时, 所有检查 (环境变量 / Git Bash 探测 /
     * 服务可用性) 都推迟到定时回调里执行, 避开启动前 2 秒的 CPU/IO 争抢
     * (AgentManager rebuild / MCP 配置读取 / LSP 初始化等都在这时间窗内).
     *
     * 决策矩阵:
     * - `CODEBUDDY_DISABLE_SHELL_SNAPSHOT=1` → 强制禁用 (所有平台)
     * - Windows 且无 Git Bash → 默认跳过 (此时 shell 降级为 PowerShell,
     *   POSIX snapshot 不适用). `CODEBUDDY_ENABLE_SHELL_SNAPSHOT=1` 可覆盖
     * - 其他情况 → 启用
     */
    private scheduleSnapshotWarmup;
    execute(params: ShellExecuteParams): Promise<ShellExecutionHandle>;
    disposeAll(): Promise<void>;
    getActiveHandleCount(): number;
    private createChildProcessHandle;
    private createPtyHandle;
    /**
     * 确保 shell snapshot 已创建，在首次执行命令时创建 snapshot；返回这次调用使用的 snapshot
     */
    private ensureSnapshot;
    /**
     * 把用户命令包装成目标 shell 能执行的完整脚本。
     *
     * 职责：
     * 1. source shell snapshot（让子进程继承用户原始的 PATH/alias 等），宿主 shell
     *    环境策略给出的变量在 source 前记下、之后按名字恢复
     * 2. 把 CODEBUDDY_SHELL_PREPEND_PATH 前置到 PATH（让 Agent 能找到 CLI Connector 装的工具）
     * 3. 读取并执行 CODEBUDDY_ENV_FILE
     * 4. 用 eval 执行用户命令
     *
     * 目录变量与 env 文件都从这次调用的合并环境读。
     *
     * 按 shell 类型分派：POSIX（bash/zsh/sh）和 PowerShell 语法完全不同，
     * 不能共用一套模板。
     */
    private formatCommand;
    /**
     * POSIX shell（bash / zsh / sh）的命令包装。
     *
     * Windows + Git Bash 场景注意：`CODEBUDDY_SHELL_PREPEND_PATH` 从 desktop 注入时是
     * Windows 路径风格（`C:\Users\...`）。Git Bash 子进程的 PATH 若含反斜杠形式，
     * `$0` 在 shim 脚本里解析会走上 MSYS 挂载根（cygpath 转出 `C:\Program Files\Git\Users\...`
     * 这种错误路径）。因此这里用 `windowsPathToUnix` 统一转换为 `/c/Users/...`
     * POSIX 形式，让 shim 里的 `dirname` + `cygpath -w` 能正确回转 Windows 路径。
     */
    private formatCommandPosix;
    /**
     * PowerShell 的命令包装。
     *
     * PowerShell 5+ 和 pwsh 7+ 都接受同一套语法：
     * - `$env:PATH = '...'` 设置环境变量
     * - `;` 语句分隔
     * - 命令本身直接交给 PowerShell 解析（不 eval）
     *
     * Shell snapshot / CODEBUDDY_ENV_FILE 机制仅对 POSIX shell 生效，这里跳过。
     */
    private formatCommandPowerShell;
    /**
     * Best-effort read of CODEBUDDY_ENV_FILE as a flat KEY=VALUE map suitable
     * for process.env. Used on the rawCommand path where no shell is available
     * to source the file. Complex shell logic in the env file (source/eval/
     * function defs) is silently skipped.
     */
    private readEnvFileAsVars;
    private isValidDirectory;
}
export declare class ShellExecutionHandleImpl implements ShellExecutionHandle {
    private readonly ptyProcess;
    private readonly headlessTerminal;
    readonly command: string;
    private readonly onOutput?;
    private readonly abortSignal?;
    private readonly logger?;
    private extraPtmxFd?;
    private readonly onTimeout?;
    private readonly safeDeleteReportPath?;
    private _disposed;
    private _exited;
    private _interrupted;
    private _result;
    private _exitPromise;
    private _exitResolve;
    private readonly _onData;
    private readonly _onExit;
    private readonly _onAlternateBuffer;
    readonly onData: import("@celljs/core").Event<string>;
    readonly onExit: import("@celljs/core").Event<ShellResult>;
    readonly onAlternateBuffer: import("@celljs/core").Event<void>;
    private readonly stdoutBuf;
    private isStreamingRawContent;
    private sniffedBytes;
    private readonly MAX_SNIFF_SIZE;
    private isWriting;
    private renderTimeout;
    private timeoutTimer;
    private _usedAlternateBuffer;
    constructor(ptyProcess: IPty, headlessTerminal: InstanceType<typeof Terminal>, command: string, onOutput?: ((chunk: {
        type: "stdout" | "stderr";
        data: string;
        timestamp: number;
    }) => void) | undefined, abortSignal?: AbortSignal | undefined, timeout?: number, logger?: Logger | undefined, extraPtmxFd?: number | undefined, onTimeout?: (() => boolean | undefined) | undefined, safeDeleteReportPath?: string | undefined);
    get id(): string;
    get pid(): number;
    get isAlive(): boolean;
    write(data: string): void;
    sendKey(key: ShellSpecialKey): void;
    resize(cols: number, rows: number): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
    /**
     * 进程已终止、但终止事件始终没来时，手动收口 `wait()`。
     *
     * 与 `kill()` 的职责严格分开：本方法**永不发信号**，只负责让一个已经没有
     * 后续事件可等的句柄收敛到终态。`kill()` 里的兜底只覆盖"进程活着 → 被杀 →
     * 事件丢失"，而"进程已经死了 → 事件丢失"这条只能由这里收（#92382）。
     *
     * @returns 是否真的发生了收口。进程还活着、或已经收口过，都返回 false。
     */
    settleIfProcessExited(): boolean;
    /**
     * 收口的具体动作。
     *
     * `exitStatusUnknown: true` 是关键：退出码无从得知，调用方不能再用
     * `exitCode ?? 0` 把 null 兜成 0，否则失败的命令会被报成成功。
     */
    private settleWithoutExitEvent;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    usedAlternateBuffer(): boolean;
    wait(): Promise<ShellResult>;
    dispose(): void;
    private handleOutput;
    private render;
    private renderFn;
    private signalNumberToName;
}
export declare class ChildProcessExecutionHandleImpl implements ShellExecutionHandle {
    private readonly shellProcess;
    readonly command: string;
    private readonly guardedCommand;
    private readonly onOutput?;
    private readonly abortSignal?;
    private readonly logger?;
    private readonly onTimeout?;
    private readonly safeDeleteReportPath?;
    private _disposed;
    private _exited;
    private _interrupted;
    private _result;
    private _exitPromise;
    private _exitResolve;
    private readonly _onData;
    private readonly _onExit;
    private readonly _onAlternateBuffer;
    readonly onData: import("@celljs/core").Event<string>;
    readonly onExit: import("@celljs/core").Event<ShellResult>;
    /** child_process 模式不支持检测 alternate buffer，此事件永不触发 */
    readonly onAlternateBuffer: import("@celljs/core").Event<void>;
    private readonly stdoutBuf;
    private readonly stderrBuf;
    private readonly outputDecoders;
    private timeoutTimer;
    constructor(shellProcess: ChildProcess, command: string, guardedCommand: string, onOutput?: ((chunk: {
        type: "stdout" | "stderr";
        data: string;
        timestamp: number;
    }) => void) | undefined, abortSignal?: AbortSignal | undefined, timeout?: number, logger?: Logger | undefined, onTimeout?: (() => boolean | undefined) | undefined, safeDeleteReportPath?: string | undefined);
    get id(): string;
    get pid(): number;
    get isAlive(): boolean;
    write(data: string): void;
    sendKey(key: ShellSpecialKey): void;
    resize(_cols: number, _rows: number): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
    /**
     * 进程已终止、但 'exit' 事件始终没来时，手动收口 `wait()`。
     * 语义与职责边界见 PTY 分支的同名方法。
     *
     * @returns 是否真的发生了收口。
     */
    settleIfProcessExited(): boolean;
    /**
     * 收口的具体动作。
     * `exitStatusUnknown: true` 的含义见 {@link ShellResult.exitStatusUnknown}。
     */
    private settleWithoutExitEvent;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    usedAlternateBuffer(): boolean;
    wait(): Promise<ShellResult>;
    dispose(): void;
    private handleOutput;
    private appendOutput;
    /** 结束时冲刷未完整的尾字节；重复调用不会重复输出。 */
    private flushPendingTails;
}
