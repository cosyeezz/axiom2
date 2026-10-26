/**
 * 后台任务文件 fd 模式下，给一个 task 分配一对 stdout/stderr 文件 + fd。
 *
 * 抽离成独立 module 而不是 BashTool 的 private 方法，是为了：
 *  - **可测试性**：单测里可以注入 fake `dirProvider`、监控 fd 是否泄漏，不用 mock 整个 IoC
 *  - **跨平台关注点集中**：Windows 上 numeric flags 经 libuv 可能 EINVAL（已用字符串 'w' 兜底），
 *    O_NOFOLLOW 在 Windows 不存在（用 `?? 0` 兜底），mode 0o700 在 NTFS 是 no-op……
 *    所有这些 footgun 集中在这里
 */
/** 单个 task 的 stdout/stderr 文件 + 父侧 fd（spawn 完调用方应立即关 fd）。 */
export interface BackgroundOutputFiles {
    stdoutPath: string;
    stderrPath: string;
    /** 父侧 fd，调用方负责在 spawn 之后立刻 close（child 已 dup 自己的副本）。 */
    stdoutFd: number;
    stderrFd: number;
}
export interface PrepareBackgroundOutputFilesOptions {
    /** task id，作为文件名前缀（`{taskId}.stdout.log` / `{taskId}.stderr.log`）。 */
    taskId: string;
    /**
     * 输出目录提供者。生产代码传 `() => PathUtils.getSessionBgTasksDir(sessionId)`，
     * 测试代码可传一个 mkdtemp 出来的临时目录。
     */
    dirProvider: () => string;
    /**
     * 是否在 Windows 平台。默认 `process.platform === 'win32'`；
     * 测试可显式传值绕开真实平台判断，从而在 macOS 上验证 Windows 分支的 flags 选择。
     */
    isWindows?: boolean;
}
/**
 * 创建文件并返回 fd。**spawn 完成后调用方必须立即关 fd**，否则父进程持有写端
 * 会让"子进程退出 → 文件 EOF"的语义出问题（虽然在文件 fd 模式下 EOF 不重要，
 * 但 fd 泄漏永远是个风险）。
 *
 * 失败时抛错；调用方应捕获并回退到 pipe 模式。
 */
export declare function prepareBackgroundOutputFiles(options: PrepareBackgroundOutputFilesOptions): Promise<BackgroundOutputFiles>;
