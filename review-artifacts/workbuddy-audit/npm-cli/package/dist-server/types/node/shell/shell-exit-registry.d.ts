export declare function registerShellPid(pid: number | undefined): void;
export declare function unregisterShellPid(pid: number | undefined): void;
/**
 * 同步整树 kill 所有已注册的 shell / PTY 子进程。必须在 process.exit 之前调用——
 * 这是退出链路上唯一确定会执行到的清理点（process.ts 的 _exitWrapped）。
 * 同步、无 await，确保不放过 event loop 让 doExit 抢跑。
 *
 * 对每个 pid 先做 process.kill(pid, 0) 存活校验：已死的 pid（ESRCH）静默跳过并
 * 从 registry 移除，避免对已退出进程发信号。
 *
 * 平台分支：
 *   - POSIX ：process.kill(-pid, 'SIGKILL') 回收整个进程组；失败（如子进程已不是
 *     组长、或组已消失）回退裸 pid，对齐 shell-service.ts kill() 现有 fallback 惯例。
 *   - Windows：`-pid` 无意义，走 WindowsProcessUtils.killProcessTreeSync
 *     （`taskkill /F /T`，本身已是同步整树 kill）。
 *
 * 存活探测为什么是「先探组、再探裸 pid」（**改动前必读，实测结论**）：
 * 其余三份 registry 只探裸 pid 即可，因为它们杀的也是裸 pid ——「组长死了」等价于
 * 「没什么可杀」。本文件杀的是进程组，两者不再等价：
 *
 *   | 场景 | kill(pid, 0) | kill(-pid, 0) |
 *   |---|---|---|
 *   | 组长存活 | OK | OK |
 *   | 组长已退出、组内仍有守护化后代（`nohup ... &`） | **ESRCH** | **OK** |
 *   | 存活但非组长（与本进程同组） | OK | **ESRCH** |
 *
 * 第二行正是本 Issue 要修的孤儿形态（后代 reparent 到 init 后仍留在原进程组）：只探
 * 裸 pid 会因 ESRCH 直接 skip，一个信号都不发。第三行说明反过来「只探组」也不行，
 * 会漏掉本该能杀的裸 pid。因此两者是 OR 关系，任一存活即继续 kill。
 *
 * pid 复用竞态：kill 探测成功 → 实际 kill 之间，目标进程恰好退出且 OS 把同一个 pid
 * 分配给了另一个无关进程，此时会误杀该进程。窗口极窄（微秒级）且 shell 子进程在
 * agent-cli 退出瞬间仍是其子进程，OS 回收再复用需跨 fork，实际概率趋近于零；
 * best-effort 兜底场景下可接受。注意：正因为组 kill 的误伤半径是「一个组」而不是
 * 「一个进程」，务必保证 unregister 可靠（见 shell-service.ts 的注销点），
 * 不要让死 pid 长期滞留在本 registry 里。
 */
export declare function killAllShellSync(): void;
