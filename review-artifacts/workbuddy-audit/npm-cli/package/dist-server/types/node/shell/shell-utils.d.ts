/**
 * List all currently open file descriptors for this process.
 * Uses /dev/fd (available on macOS and Linux) which is instantaneous,
 * instead of spawning lsof which blocks the event loop for seconds.
 * Returns empty set on Windows or if /dev/fd is unavailable.
 */
export declare function listOpenFds(): Set<number>;
/**
 * Detect the extra ptmx fd leaked by node-pty's pty.fork().
 * Compares fd snapshots taken before/after spawn, then verifies the new fd
 * is a character device (ptmx) rather than some unrelated fd.
 */
export declare function findLeakedPtmxFd(fdsBefore: Set<number>, fdsAfter: Set<number>, masterFd: number | undefined): number | undefined;
export type PtyImplementation = {
    module: any;
    name: 'lydell-node-pty' | 'bun-native-pty';
} | null;
type AvailablePtyImplementation = NonNullable<PtyImplementation>;
/**
 * Spawn a PTY while tracking the extra ptmx descriptor leaked by node-pty.
 *
 * The descriptor scan is specific to `@lydell/node-pty`. Bun owns every
 * descriptor behind its native Terminal object, so inspecting and later
 * closing an arbitrary new character-device fd can corrupt an unrelated Bun
 * file or socket after descriptor reuse.
 */
export declare function spawnPtyWithFdLeakTracking<T extends object>(implementation: AvailablePtyImplementation, spawnPty: () => T): {
    readonly extraPtmxFd?: number;
    readonly ptyProcess: T;
};
export interface PtyProcess {
    readonly pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (e: {
        exitCode: number;
        signal?: number;
    }) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
}
export declare const getPty: () => Promise<PtyImplementation>;
/**
 * Shell type identifier.
 *
 * Common values: 'bash', 'zsh', 'sh', 'fish', 'tcsh', etc.
 * The type allows any string to support unknown shells while providing
 * type hints for common ones.
 */
export type ShellType = 'bash' | 'zsh' | 'sh' | (string & {});
/**
 * Shell types that support snapshot creation.
 *
 * Snapshot creation requires POSIX-compatible shells that support:
 * - The `-c` argument for command execution
 * - POSIX shell syntax for the snapshot script
 *
 * Supported: bash, zsh, sh (POSIX-compatible shells)
 * Not supported: fish, tcsh, csh (incompatible syntax and argument handling)
 */
export declare const SNAPSHOT_SUPPORTED_SHELLS: ReadonlySet<string>;
export interface ShellConfiguration {
    executable: string;
    argsPrefix: string[];
    shell: ShellType;
}
export declare function isWindows(): boolean;
/**
 * Check if Git Bash is available on the current system.
 * On non-Windows platforms, always returns true (bash is always available).
 * On Windows, checks if Git for Windows bash.exe can be found.
 */
export declare function isGitBashAvailable(): boolean;
/**
 * Get PowerShell configuration for Windows fallback.
 *
 * Used when Git Bash is not available. Tries pwsh (PS 7+) first,
 * then falls back to powershell.exe (PS 5.1), then default path.
 * Throws only if no PowerShell can be found at all.
 */
export declare function getPowerShellArgsPrefix(isWin?: boolean): string[];
/**
 * Get shell configuration for command execution.
 *
 * Priority:
 * 1. Environment variable CODEBUDDY_CODE_SHELL (user override)
 * 2. Default:
 *    - Windows: Git Bash → PowerShell fallback (if no Git Bash)
 *    - POSIX: $SHELL → /bin/sh
 *
 * Note: This function returns the user's preferred shell for command execution.
 * Snapshot creation has its own logic to handle unsupported shells (fish, tcsh, etc.)
 * by skipping snapshot creation gracefully.
 */
export declare function getShellConfiguration(): ShellConfiguration;
/**
 * Check if a shell supports snapshot creation.
 *
 * @param shellType - The shell type to check (e.g., 'bash', 'zsh', 'fish')
 * @returns true if the shell supports snapshot creation
 */
export declare function isSnapshotSupportedShell(shellType: ShellType): shellType is 'bash' | 'zsh' | 'sh';
export declare function ensureShoptDisabled(command: string, shell: ShellType): string;
export declare function resetEncodingCache(): void;
export declare function getCachedEncodingForBuffer(buffer: Buffer): string;
export declare function getSystemEncoding(): string | null;
export declare function windowsCodePageToEncoding(cp: number): string | null;
export declare function detectEncodingFromBuffer(buffer: Buffer): string | null;
/**
 * 检测 UTF-8 有效性（检查是否有替换字符 \uFFFD）
 */
export declare function isValidUtf8(str: string): boolean;
/**
 * 从 Buffer 末尾切出"可能未完成的 UTF-8 多字节序列前缀"。
 *
 * 背景（issue #34726）：
 * child_process 的 stdout pipe 会按任意字节边界把输出切成 chunk，当一个 UTF-8
 * 多字节字符（汉字为 3 字节）被切在两个 chunk 中时：前一 chunk 最后 1~2 字节
 * 自身不构成合法 UTF-8，`decodeBuffer` 会把它当成非法字节走到 cp936 回退，
 * 产出乱码；后一 chunk 同理缺了首字节，整串中文被破坏成替换符。
 *
 * 解决办法：stdout handler 维护一个 pending Buffer，每次把"未完成尾巴"切出
 * 保留到下一 chunk 前端再拼起来。只检测 UTF-8 起始字节的多字节序列
 * （0xC0-0xFD，长度 2~4），不处理 GBK 双字节切断——那是次生问题，且 GBK
 * 高字节 >=0x81 极容易和 ASCII 冲突，自动探测不可靠。
 *
 * @returns { ready } 可立即解码的部分；{ pending } 需保留到下一 chunk 前端的尾巴。
 */
export declare function splitPendingUtf8Tail(data: Buffer): {
    ready: Buffer;
    pending: Buffer;
};
/**
 * Windows Git Bash / cmd.exe 子进程 stdout/stderr 智能解码。
 *
 * 策略（按顺序）：
 *  1. 纯 ASCII → 直接 ASCII 解码（最常见、最便宜的分支）。
 *  2. 严格 UTF-8 校验（TextDecoder fatal 模式）通过 → 以 UTF-8 解码。
 *     这一步优先 UTF-8 的理由：shell-service 已经在 Windows 下注入了
 *     `PYTHONIOENCODING=utf-8`、`PYTHONUTF8=1`、`LANG/LC_ALL=C.UTF-8` 等环境变量,
 *     主动把 Python / Git / less 等子进程的输出锁定为 UTF-8。只要字节流合法，
 *     就应信任它是 UTF-8；避免被 jschardet 对短样本 / 误判（常见于短中文串）
 *     拽到 cp936 分支，从而把真正的 UTF-8 中文解成乱码（issue #34726）。
 *  3. 若 UTF-8 校验失败，再用 jschardet 检测。只有置信度显著高（>=0.9）
 *     且 iconv 支持该编码时才采用；否则继续降级。
 *  4. 回退到 GBK（CP936，中文 Windows 系统默认代码页），兜住未被 UTF-8 锁定
 *     的原生程序（cmd.exe 的 dir、ping、原生 exe 等）。
 *  5. Final fallback：宽松 UTF-8（允许含 \uFFFD）。
 *
 * 注意：调用方应配合 `splitPendingUtf8Tail` 在 chunk 边界保留未完成的
 * UTF-8 多字节序列，否则 chunk 切断会令本函数误把合法 UTF-8 字节流
 * 判为非法并回退到 cp936，产生乱码。
 */
export declare function decodeBufferWindows(data: Buffer | string): string;
/**
 * 通用 Buffer 解码函数，自动根据平台选择策略
 */
export declare function decodeBuffer(data: Buffer | string): string;
export declare function decodeBufferPosix(data: Buffer): string;
/** 只兜底字符编码，保留现有 UTF-8 locale 及其他 locale 分类。 */
export declare function getShellLocaleEnv(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): Record<string, string>;
/** 在 source 之后按实际 Shell 环境兜底；不把宿主环境快照重新覆盖过去。 */
export declare function buildShellLocaleBootstrap(): string;
export declare function isBinary(data: Buffer | null | undefined, sampleSize?: number): boolean;
/**
 * Convert Windows path to Unix-style path for Git Bash.
 *
 * Examples:
 *   C:\Users\Admin\.codebuddy\file.sh → /c/Users/Admin/.codebuddy/file.sh
 *   D:\Projects\test → /d/Projects/test
 *
 * This is necessary because Windows backslashes are interpreted as escape
 * characters when the path is used in shell commands.
 */
export declare function windowsPathToUnix(winPath: string): string;
/**
 * Convert a Git Bash / MSYS Unix-style path back to a native Windows path.
 * Inverse of `windowsPathToUnix`.
 *
 * Examples:
 *   /c/Users/Admin/.codebuddy/file.ps1 → C:\Users\Admin\.codebuddy\file.ps1
 *   /d/Projects/test                   → D:\Projects\test
 *
 * Only paths shaped like `/<driveLetter>/...` are rewritten. Anything else
 * (already-native Windows paths, relative paths, UNC paths, etc.) is returned
 * unchanged so callers can safely pass arbitrary arguments through.
 *
 * Background (issue #63535): the directPowerShell hook branch spawns
 * `powershell.exe -File "/c/Users/.../x.ps1"`. Native PowerShell does not
 * understand the MSYS `/c/` form and fails with "cannot find file", so the
 * `-File` argument must be restored to `C:\Users\...\x.ps1` first.
 */
export declare function unixPathToWindows(unixPath: string): string;
/**
 * Escape a file path for safe use in shell commands.
 * Handles both Windows and Unix paths appropriately.
 */
export declare function escapePathForShell(filePath: string): string;
/**
 * Split a Windows-style command line into { exe, args[] }.
 *
 * Rules (intentionally narrow — only what PowerShellTool emits today):
 *  - Tokens are separated by whitespace (space or tab) OUTSIDE of quotes.
 *  - A double-quoted region preserves spaces; the surrounding `"` is stripped.
 *  - Inside a double-quoted region:
 *      * `` `" ``  (backtick-quote)  → literal `"`   (PowerShell escape)
 *      * `\"`      (backslash-quote) → literal `"`   (defensive, common escape)
 *      * every other character, including `\` (Windows paths) and backtick
 *        alone, is taken literally.
 *  - Outside quotes: all characters are literal (backslashes NOT escape chars).
 *  - No CMD `""` escaping, no POSIX `\\` escaping, no single-quote handling
 *    (single quotes are treated as ordinary characters — matches Windows
 *    CreateProcessW / pwsh.exe argument semantics for this limited use case).
 *
 * Throws on an empty/whitespace-only input or an unterminated quoted token.
 */
export declare function parseCommandLine(cmdline: string): {
    exe: string;
    args: string[];
};
/**
 * Best-effort parser for `CODEBUDDY_ENV_FILE` content when we cannot run
 * a shell (i.e. the rawCommand path). Supports two line shapes:
 *   KEY=VALUE
 *   export KEY=VALUE
 * Values may be wrapped in single or double quotes (outer pair stripped).
 * Blank lines and lines starting with `#` are ignored. Anything else
 * (function definitions, `source ...`, command substitution, heredocs) is
 * skipped silently — we cannot evaluate arbitrary shell without a shell.
 */
export declare function parseEnvFile(content: string): Record<string, string>;
export {};
