/**
 * 后台 job 的进程身份。
 *
 * `CODEBUDDY_JOB_ID` / `CODEBUDDY_JOB_CONTROL_SOCKET` 若留在 `process.env` 里，
 * 会随 `...process.env` 被 shell / daemon / teammate 等派生进程继承。嵌套的
 * CLI 会认领同一个 job：退出时 unlink 活着的 broker socket、看门狗误杀、
 * detach 踢掉真 attacher。所以模块加载后立刻把身份摘进本模块变量并从
 * 环境里删掉；本进程靠 getter 读，子进程靠派生入口显式清除（或重新注入）。
 */
/** 不得传给派生进程的 job 身份键 */
export declare const JOB_IDENTITY_ENV_KEYS: readonly ["CODEBUDDY_JOB_HEADLESS", "CODEBUDDY_JOB_ID", "CODEBUDDY_JOB_LAUNCH_TOKEN", "CODEBUDDY_JOB_GENERATION", "CODEBUDDY_JOB_CONTROL_SOCKET", "CODEBUDDY_JOB_BROKER", "CODEBUDDY_JOB_INNER_ENTRY", "CODEBUDDY_JOB_RECLAIM_TOKEN"];
/**
 * 从环境变量捕获身份并删除，防止再被继承。
 *
 * 可安全重复调用；非 job 进程也是 no-op。必须在看门狗 / 会话基建读身份之前调用。
 */
export declare function claimJobIdentity(env?: NodeJS.ProcessEnv): void;
/** 从任意 env 字典里摘掉 job 身份键（派生入口的显式清除） */
export declare function scrubJobIdentityFromEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): void;
export declare function getJobId(): string | undefined;
/** Headless workers use their own PID; PTY workers keep the broker generation. */
export declare function getCurrentJobGeneration(): number | undefined;
export declare function getJobGeneration(): number | undefined;
export declare function getJobLaunchToken(): string | undefined;
export declare function getJobReclaimToken(): string | undefined;
export declare function isHeadlessJobProcess(): boolean;
export declare function getJobControlSocket(): string | undefined;
/** 当前进程是不是外层 PTY broker（没有会话，不应 drain inbox / 汇报状态） */
export declare function isJobBrokerProcess(): boolean;
/** 当前进程是不是 broker 托管的内层会话 */
export declare function isBrokeredSession(): boolean;
/**
 * 从 worker PID 文件反推 job id。
 *
 * 外层 broker 不注册 PID 文件；inner 注册时 sessionId 经常还是 `bg-<pid>`
 * 占位（`--resume` 尚未同步 UUID）。Web UI 的 webUrl / live.status 若只按
 * sessionId 关联，就会把 TUI 里已经 Idle、可 attach 的会话画成恢复中/不可用。
 */
export declare function jobGenerationFromPidEntry(entry: {
    meta?: Record<string, string>;
}): number | undefined;
export declare function jobIdFromPidEntry(entry: {
    name?: string;
    meta?: Record<string, string>;
}): string | undefined;
/** PID 注册用的 sessionId：优先 `--session-id`，其次 `--resume <uuid>`。 */
export declare function registrySessionIdFromCliOpts(opts: {
    sessionId?: unknown;
    resume?: unknown;
}, fallback: string): string;
/** 仅供测试：重置模块状态并允许重新 claim */
export declare function resetJobIdentityForTests(): void;
