/**
 * 安全退出工具
 *
 * 提供统一的退出处理,确保在退出前恢复终端状态(如 raw mode)
 * 避免退出后终端光标丢失等问题
 */
export interface SafeExitOptions {
    /**
     * 强制真正退出，即使当前是 broker 托管的后台会话。
     * 信号 / 进程兜底路径必须设为 true；用户敲的 /exit 不要设。
     */
    force?: boolean;
}
export declare abstract class SafeExitUtils {
    /**
     * 安全退出进程
     *
     * 在退出前会:
     * 1. 恢复 stdin 的 raw mode
     * 2. 调用 process.exit(code)
     *
     * **后台会话例外**：进程跑在 PTY broker 里时（`/bg`、`←` 交接、dispatch 出来的
     * 会话），"退出"的意思是**脱离终端**而不是结束会话 —— 这里是 `/exit`、`/quit`、
     * 双击 Ctrl+C、Ctrl+D 共同的收口，所以四条路径一并改掉。真正结束一个后台会话
     * 的是 agent view 里的 stop（给 broker 发 SIGTERM），不是用户在会话里敲退出。
     *
     * 调用方必须自己跳过退出前拆除（SessionEnd hooks、telemetry shutdown、
     * worktree 删除）：那些只对真退出有意义，detach 时跑会把还在跑的会话拆掉。
     *
     * @param code 退出码,默认为 0
     * @param options.force 信号路径用：跳过 detach，真正 process.exit
     */
    static exit(code?: number, options?: SafeExitOptions): void;
    private static exitProcess;
}
