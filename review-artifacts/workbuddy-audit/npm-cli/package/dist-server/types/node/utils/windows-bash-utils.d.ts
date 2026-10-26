export declare class WindowsBashUtils {
    private static cachedBashPath;
    static verifyPathExists(filepath: string): boolean;
    /**
     * 检查是否为 WSL 的 bash.exe
     * WSL bash 位于 System32/SysWOW64，执行时会启动 Linux 子系统
     */
    static isWslBash(bashPath: string): boolean;
    /**
     * 检查是否为 Git for Windows 的 bash.exe
     * Git Bash 通常位于 Git 安装目录的 bin 或 usr/bin 下
     */
    static isGitBash(bashPath: string): boolean;
    static findExecutableInPath(executableName: string): string | undefined;
    static findBashPath(): string | undefined;
    private static doFindBashPath;
    static clearCache(): void;
    /**
     * 记录一次「CODEBUDDY_CODE_GIT_BASH_PATH 指向的路径不存在」的告警。
     *
     * 优先用项目自带的持久化日志（{@link LoggerStorageService.storeSync} → ~/.codebuddy/logs），
     * 让证据能留存下来供事后排障（issue #60459）。容器尚未就绪时（如极早启动阶段）退回
     * console.warn。全程 best-effort：日志本身失败绝不再抛，避免二次影响会话。
     */
    private static warnInvalidEnvPath;
}
