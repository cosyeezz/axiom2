import { Disposable, Event } from '@celljs/core';
import type { AnsiOutput } from './terminal-serializer';
export declare const DEFAULT_BASH_TIMEOUT_MS = 120000;
export declare const DEFAULT_BASH_MAX_TIMEOUT_MS = 600000;
export declare const DEFAULT_BASH_MAX_OUTPUT_LENGTH = 30000;
export declare const MAX_BASH_OUTPUT_LENGTH_CAP = 150000;
/**
 * 主 agent 前台阻塞预算（Kairos 式，对齐 Claude Code ASSISTANT_BLOCKING_BUDGET_MS=15000）。
 *
 * 默认值 0 = 禁用（CC 公开版 `feature('KAIROS')` 也默认为 false，此机制在公开版不生效）。
 * 设置为 >0 时，主 thread 的前台 Bash 命令超过此时间会自动转为后台任务，
 * 让主 agent 继续响应其他操作；命令本身不被 kill，继续在后台跑。
 *
 * 可通过 env `CODEBUDDY_BASH_ASSISTANT_BUDGET_MS` 覆盖。
 */
export declare const DEFAULT_BASH_ASSISTANT_BUDGET_MS = 0;
/** Resolve the foreground assistant budget from the current runtime environment. */
export declare function resolveBashAssistantBudgetMs(env?: NodeJS.ProcessEnv): number;
/**
 * 从给定的环境变量字典解析 bash 超时配置。
 * 显式传入的 settings env 优先；缺失或无效字段回退到运行时 process.env，再回退默认值。
 */
export declare function resolveBashTimeoutFromEnv(env?: Record<string, string>): {
    defaultTimeout: number;
    maxTimeout: number;
};
/** Resolve the model-facing shell output budget from the current runtime environment. */
export declare function resolveMaxShellOutputLength(env?: NodeJS.ProcessEnv): number;
export declare const ShellService: unique symbol;
/**
 * 本地 Shell 服务 Symbol，用于标识原始的 ShellServiceImpl。
 * DelegatingShellService 通过此 Symbol 注入本地执行实现。
 */
export declare const LocalShellService: unique symbol;
export interface ShellService {
    execute(params: ShellExecuteParams): Promise<ShellExecutionHandle>;
    disposeAll(): Promise<void>;
    getActiveHandleCount(): number;
}
export interface ShellOutputChunk {
    type: 'stdout' | 'stderr';
    data: string;
    timestamp: number;
}
export interface ShellExecuteParams {
    /** Optional captured host environment; defaults to process.env. */
    processEnv?: NodeJS.ProcessEnv;
    /**
     * The Host's shell environment policy answer for this call, set above
     * `processEnv`. Settings read from the environment, such as the env file
     * and the prepended directories, are read from the combined view, and the
     * POSIX wrapper exports these names again after the shell snapshot loads.
     */
    shellEnvironment?: import('../execution-context/shell-environment-policy').ShellEnvironmentSet;
    command: string;
    /**
     * The run's session, passed explicitly by tool callers. Multi-session
     * surfaces (agent-cli/server) route on it — never rely on the
     * current-session slot or ambient context for shell dispatch.
     */
    session?: import('../../vendor/cbc-core/node/index.js').Session;
    /**
     * Execute a trusted executable with an already-tokenized argument vector.
     * No shell or command-line parser is involved. This is intended for
     * internal callers such as Grep that need identical argv in local and
     * sandbox-backed execution paths.
     */
    directCommand?: {
        executable: string;
        args: string[];
        displayCommand?: string;
        pathOverride?: string;
    };
    cwd?: string;
    timeout?: number;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    onOutput?: (chunk: ShellOutputChunk) => void;
    abortSignal?: AbortSignal;
    /** Set to false to force child_process fallback (skip PTY). Defaults to true. */
    usePty?: boolean;
    /** 无输入消费者的工具调用关闭 stdin；PTY 输出和显式命令重定向保持不变。 */
    stdinMode?: 'ignore';
    /**
     * Optional callback for handling sandbox intercept events.
     * When sandbox-cli blocks a command due to policy violation, this callback is invoked
     * with the intercept details. Return user's choice: 'allow_once' | 'allow_session' | 'deny'.
     *
     * Provided by BashTool to bridge sandbox intercepts into the standard
     * InterruptionService/Permission flow using the current tool call context.
     * If not provided, SandboxShellService uses ACP requestPermission callback or auto-allows.
     */
    onSandboxIntercept?: (event: {
        interceptType: string;
        command: string;
        operation: string;
        target: string;
        details: unknown;
    }) => Promise<'allow_once' | 'allow_session' | 'deny'>;
    /**
     * Optional tool call ID for correlating sandbox intercepts with the originating tool call.
     * Used by SandboxShellService to route InterceptNotification to the correct handler.
     */
    toolCallId?: string;
    /**
     * When true, SandboxShellService executes with executionMode: 'sandbox_bypass',
     * bypassing sandbox isolation. Corresponds to BashTool's dangerouslyDisableSandbox parameter.
     */
    sandboxBypass?: boolean;
    /**
     * When true, `command` is already a complete command line
     * (e.g. `pwsh -NoProfile -Command "..."`) and MUST NOT be wrapped by
     * shell-service machinery.
     *
     *  - SandboxShellService: passes `command` through to sandbox-cli verbatim
     *    (no `buildSandboxCommand`).
     *  - LocalShellService: parses `command` via `parseCommandLine(...)` and
     *    calls `spawn(exe, args[])` directly — no bash `-c`, no shopt guard,
     *    no `eval`, no snapshot sourcing. `CODEBUDDY_ENV_FILE` is loaded as
     *    KEY=VALUE pairs and merged into the child's `env`. PTY is forced
     *    off on this path (node-pty would re-introduce a shell).
     *
     * Used by PowerShellTool to pass raw PowerShell invocations through the
     * sandbox orchestrator without bash-mangling on Windows.
     */
    rawCommand?: boolean;
    /**
     * Invoked by SandboxShellService immediately before a post-exec escalation retry.
     * Callers that accumulate streaming output (e.g. BashTool's buffers) should clear
     * their state here so the retry output is observed as a fresh stream rather than
     * appended to the first-attempt output. Not invoked in non-retry execution paths
     * or by LocalShellService.
     */
    onSandboxRetryStart?: () => void;
    /**
     * 命令到达 `timeout` 时的自定义处理回调。
     *
     * 如果返回 `true`，shell-service 认为调用方已接管后续处理（典型场景：
     * BashTool 把命令转为后台任务继续跑），shell-service **不再发送 SIGTERM**，
     * 子进程继续运行；`wait()` 返回的结果由调用方自行管理。
     *
     * 如果返回 `false` 或没有提供此回调，shell-service 维持原行为：
     * 设置 `interrupted = true` 并调 `kill('SIGTERM')`。
     *
     * 同步返回值；异步决策需要调用方在外部处理（例如先快照 handle、再在外部监听）。
     *
     * @returns true 表示已接管；false/undefined 表示走默认 kill 路径。
     */
    onTimeout?: () => boolean | undefined;
    /**
     * 当提供时，子进程的 stdout 直接写入这个文件描述符，**不通过 pipe 回传到父进程**。
     *
     * 仅 LocalShellService 的 ChildProcess 路径生效（即 `usePty: false` 或 PTY 不可用时）；
     * PTY 路径和 SandboxShellService 会忽略此参数（PTY 必须接管 stdio，sandbox 走 IPC 协议）。
     *
     * 用于解决"后台任务的孙进程持有父进程 pipe fd 导致 EOF 不来 / nohup 残留 defunct"问题：
     * 当 stdout 直接写文件，孙进程继承的也是这个文件 fd，父 bash 退出立即触发 'exit'，
     * 不依赖 grandchild 关闭 fd。参考 Claude Code `Shell.ts` 的实现。
     *
     * **fd 生命周期由调用方负责**：调用方 open 这个 fd，spawn 完成后 child 已 dup 自己的副本，
     * 调用方应立即 close 父侧 fd（避免父进程持有写端导致后续读取卡住）；ShellService 不会 close。
     */
    stdoutFd?: number;
    /**
     * 同 {@link stdoutFd}，给 stderr。
     *
     * 可与 stdoutFd 指向同一个 fd（依赖 POSIX O_APPEND 的原子写入语义），
     * 也可分开写两个文件（codebuddy 的默认做法，便于 UI 区分 stderr）。
     */
    stderrFd?: number;
}
/**
 * 网络拦截记录的业务视图（ShellResult 暴露给上层 tools / orchestrator / telemetry 的形态）。
 *
 * Sandbox ProcessExit 仅上送 DecisionRecord；执行句柄在 IPC 边界将其投影为本
 * 业务视图，保持 tools / orchestrator / telemetry 的既有接口不变。
 */
export interface ShellNetworkBlockRecord {
    /** 被拦截的目标主机（优先域名，无域名时为 IP） */
    host: string;
    /** 端口号（可选） */
    port?: number;
    /** 协议类型: "tcp" / "udp" / "dns" / "https" 等（vendor 协议层字段名为 `scheme`，本视图统一为 `protocol`） */
    protocol: string;
    /** 操作类型 bitmask: 0x01=CONNECT, 0x02=DNS_RESOLVE, 0x04=SENDTO */
    actionMask: number;
    /** 沙箱建议的可选处理方式。 */
    options?: string[];
    /** 触发拦截的命令（若 Sandbox 能提供）。 */
    command?: string;
    /** Vendor 原始记录，保留用于诊断。 */
    raw?: import('../sandbox-cli/sandbox-cli-protocol.js').JsonValue;
    /**
     * 网络拦截成因；DecisionRecord 投影使用 center_ask / center_deny 区分三态。
     */
    reason?: import('../sandbox-cli/sandbox-cli-protocol.js').NetworkBlockReason;
    /** 恶意域名 DB 命中时的威胁标签。 */
    maliciousLabel?: string;
    /** DB 实际命中的候选域名（可能是请求域名的父域）。 */
    matchedDomain?: string;
    /** DB 中原始的主域匹配字段。 */
    mainDomainMatch?: boolean;
}
export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    /** 命令是否被中断（超时或用户取消） */
    interrupted: boolean;
    /**
     * `exitCode` / `signal` 是否不可信。
     *
     * 缺省（undefined / false）表示这份结果来自真实的进程终止事件，退出码可以直接用。
     * 置 `true` 表示句柄是靠"进程已不存在"这个状态兜底收口的——终止事件始终没到，
     * 退出码无从得知，此时 `exitCode: null` 不代表成功，调用方**不能**再用
     * `exitCode ?? 0` 这类兜底把它归一成 0。
     *
     * 为什么需要它：线上实测约 11% 的后台子进程收不到终止事件（#92382），
     * 没有这个标记，兜底收口会把一个失败的命令报成 completed。
     */
    exitStatusUnknown?: boolean;
    /** safe-delete shim 成功把目标移入系统回收站的 side-channel 事件，不进入 stdout/stderr。 */
    safeDeleteEvents?: import('./safe-delete/index.js').SafeDeleteReportEvent[];
    /** Windows 沙箱内 safe-delete shim 原生 rm 删除成功的路径，批量确认重跑时据此跳过首跑已删目标。 */
    safeDeleteNativeDeletedPaths?: string[];
    /** 由 DecisionRecord 在 IPC 边界映射出的旧文件拦截业务视图。 */
    fileBlockRecords?: import('../sandbox-cli/sandbox-cli-protocol.js').FileBlockRecord[];
    /** Center authority records from the current process execution. */
    decisionRecords?: import('../sandbox-cli/sandbox-cli-protocol.js').DecisionRecord[];
    /** 由 DecisionRecord 在 IPC 边界映射出的旧网络拦截业务视图。 */
    networkBlockRecords?: ShellNetworkBlockRecord[];
    /** 沙箱是否拒绝了操作导致命令失败 */
    sandboxDenied?: boolean;
    /** 命中用户配置的硬拒绝规则，当前 Agent run 应直接结束 */
    policyDenied?: boolean;
    /**
     * 安全规则终局拒绝的结构化说明。
     *
     * 文件 / 网络裁决发生在沙箱首跑之后：命令已经真跑过一遍，OS 层的
     * `Operation not permitted` 早已通过 `onData` 流进工具的输出缓冲。置位该字段
     * 表示"这次失败的权威原因是安全规则，不是命令本身"，工具层应当用它替代缓冲区
     * 里的原始报错来展示。
     *
     * 与 `policyDenied` 正交：后者会终止整个 Agent run，此字段只影响展示。
     */
    denialMessage?: string;
    /** 被沙箱阻止的文件路径列表 */
    sandboxBlockedPaths?: string[];
    /** 用户是否已拒绝提权请求 (区分 "没走提权" 和 "走了但用户拒绝") */
    sandboxEscalationDenied?: boolean;
    /** 命令因系统级工具安全策略被拦截（区分于通用 sandboxDenied） */
    systemToolBlocked?: boolean;
    /** 沙箱提权后重试成功，BashTool 应使用 ShellResult.stdout/stderr 而非 execCtx buffer */
    sandboxRetried?: boolean;
    /**
     * Populated by the SandboxOrchestrator when the command ended up running
     * outside the sandbox (e.g. after `dangerouslyDisableSandbox` approval, a
     * cached `allow_session` decision, or a post-exec escalation). Downstream tools can surface this to the LLM so it
     * knows the command did not run under sandbox isolation.
     */
    sandboxBypassed?: boolean;
    /** Reason recorded when `sandboxBypassed` is true; see SandboxBypassReason. */
    sandboxBypassReason?: 'dangerously-disable-sandbox' | 'session-approved' | 'escalation-approved' | 'exec-policy-allow' | 'system-tool-approved';
}
export interface ShellExecutionHandle extends Disposable {
    readonly id: string;
    readonly pid: number;
    readonly isAlive: boolean;
    readonly command: string;
    write(data: string): void;
    sendKey(key: ShellSpecialKey): void;
    resize(cols: number, rows: number): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
    getScreen(): string;
    getColorScreen(): AnsiOutput;
    usedAlternateBuffer(): boolean;
    wait(): Promise<ShellResult>;
    /**
     * 若进程已终止而终止事件始终没来，则手动收口 {@link wait}；否则什么都不做。
     *
     * 与 {@link kill} 的职责严格分开：本方法**永不发信号**。`kill` 内部的兜底只覆盖
     * 「进程活着 → 被杀 → 事件丢失」，而「进程已经死了 → 事件丢失」这条只能由本方法
     * 收口——线上实测约 11% 的后台子进程走到后一种情形（#92382），不收口则 `wait()`
     * 永久挂起，依赖它的后台任务终态判定与通知全部停摆。
     *
     * 可选：sandbox 侧的句柄实现暂未接入，调用方需用 `?.` 并对 undefined 做兜底。
     *
     * @returns 是否真的发生了收口；进程仍存活或已收口过都返回 false。
     */
    settleIfProcessExited?(): boolean;
    readonly onData: Event<string>;
    readonly onExit: Event<ShellResult>;
    /** 当检测到程序进入 alternate screen buffer 时触发（TUI 程序特征） */
    readonly onAlternateBuffer: Event<void>;
}
export type ShellSpecialKey = 'CTRL_A' | 'CTRL_B' | 'CTRL_C' | 'CTRL_D' | 'CTRL_E' | 'CTRL_F' | 'CTRL_G' | 'CTRL_H' | 'CTRL_I' | 'CTRL_J' | 'CTRL_K' | 'CTRL_L' | 'CTRL_M' | 'CTRL_N' | 'CTRL_O' | 'CTRL_P' | 'CTRL_Q' | 'CTRL_R' | 'CTRL_S' | 'CTRL_T' | 'CTRL_U' | 'CTRL_V' | 'CTRL_W' | 'CTRL_X' | 'CTRL_Y' | 'CTRL_Z' | 'ENTER' | 'TAB' | 'ESCAPE' | 'BACKSPACE' | 'DELETE' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'HOME' | 'END' | 'PAGE_UP' | 'PAGE_DOWN';
