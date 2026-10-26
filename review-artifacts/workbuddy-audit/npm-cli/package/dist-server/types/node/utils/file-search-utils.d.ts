interface ExecResult {
    files: string[];
    dirs: string[];
    success: boolean;
}
export declare abstract class FileSearchUtils {
    static timeout: number;
    static token: AbortController | undefined;
    private static readonly MAX_FILES;
    private static readonly MAX_DIRS;
    private static readonly MAX_DEPTH;
    private static readonly GIT_MAX_BUFFER;
    private static readonly GIT_TIMEOUT_MS;
    private static readonly VCS_INTERNAL_DIRS;
    /**
     * 判断路径是否位于版本控制内部目录中（任意层级的路径段命中即算）。
     * 同时兼容 POSIX 与 Windows 分隔符。
     */
    private static isInsideVcsInternalDir;
    static exec(searchDir?: string): Promise<ExecResult>;
    /**
     * 使用 `git ls-files` 枚举受版本控制的文件（对齐 Claude Code 的文件候选实现）。
     *
     * 分两批执行（git 不允许 `--recurse-submodules` 与 `--others` 同时使用）：
     * - tracked：`ls-files --recurse-submodules` —— 已跟踪文件，并递归子模块内部文件
     * - untracked：`ls-files --others [--exclude-standard]` —— 未跟踪文件；
     *   `--exclude-standard` 仅当用户未开启 `ignoreGitIgnore` 时附加（遵循
     *   .gitignore / .git/info/exclude / 全局 gitignore，与现有搜索语义保持一致）
     *
     * tracked 批是必需的；untracked 批失败时降级为仅使用 tracked 结果，不连累整体。
     * 在 git 子目录运行时，输出路径相对于 `searchDir` 子树，scope 正确。
     *
     * @returns 成功返回结果；非 git 仓库或 tracked 批失败返回 null（由调用方回退）。
     */
    static execGit(searchDir: string): Promise<ExecResult | null>;
    /**
     * 执行一次 `git ls-files`，返回 stdout。
     * core.quotepath=false 确保非 ASCII 路径不被转义。
     */
    private static runGitLsFiles;
    /**
     * 解析一批 `git ls-files` 输出（\n 分隔），把文件累加进 files，并从每个文件
     * 路径向上回溯补全所有层级的父目录到 dirsSet。seen 用于跨批次去重。
     *
     * stdout 容错处理：Windows 下 git 输出为 CRLF，需剥掉行尾 \r，否则路径带控制字符
     * 会污染候选项与后续 Read/Edit 的入参。
     */
    private static collectGitLines;
    static execRg(searchDir?: string): Promise<ExecResult>;
    static execFg(searchDir?: string): Promise<ExecResult>;
}
export {};
