export declare function registerRipgrepPid(pid: number | undefined): void;
export declare function unregisterRipgrepPid(pid: number | undefined): void;
/**
 * 同步 SIGKILL 所有已注册的 ripgrep 子进程 pid。必须在 process.exit 之前调用——
 * 这是退出链路上唯一确定会执行到的清理点（process.exit wrapper）。
 * 同步、无 await，确保不放过 event loop 让 doExit 抢跑。
 *
 * 对每个 pid 先做 process.kill(pid, 0) 存活校验：已死的 pid（ESRCH）静默跳过并
 * 从 registry 移除，避免对已退出进程发信号。
 *
 * pid 复用竞态：kill(pid, 0) 返回成功 → kill(pid, SIGKILL) 之间，目标进程恰好退出
 * 且 OS 把同一个 pid 分配给了另一个无关进程，此时会误杀该进程。窗口极窄（微秒级）
 * 且 ripgrep 子进程在 agent-cli 退出瞬间仍是其子进程，OS 回收再复用需跨 fork，
 * 实际概率趋近于零；best-effort 兜底场景下可接受。
 */
export declare function killAllRipgrepSync(): void;
