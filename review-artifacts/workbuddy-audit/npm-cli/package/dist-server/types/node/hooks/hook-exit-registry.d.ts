export declare function registerHookPid(pid: number | undefined): void;
export declare function unregisterHookPid(pid: number | undefined): void;
/**
 * 仅供测试观测用：当前登记的 pid 数量。
 *
 * 存在的必要性：生命周期回归（「hook 一死就必须摘除」）需要在**不改变状态**的前提下
 * 反复检查 registry。若用 killAllHooksSync() 来间接观测，它自身会 clear registry
 * 并触发优雅期同步等待，既污染被测状态又让轮询无从下手。
 */
export declare function __getRegisteredHookPidCountForTest(): number;
/**
 * 同步回收所有已注册的 hook 子进程及其**后代链**。必须在 process.exit 之前调用——
 * 这是退出链路上唯一确定会执行到的清理点（process.ts 的 _exitWrapped）。
 * 全程同步、无 await，确保不放过 event loop 让 doExit 抢跑。
 *
 * 两阶段（POSIX）：
 *   1. 先 SIGSTOP 冻结所有存活的注册 pid，在冻结窗口内做一次快照把每个 pid 展开成
 *      「自身 + 后代」（**必须在发信号前**，shell 一死父子链就断），对整条链上所有存活
 *      pid 发 SIGTERM 给一个收尾窗口（见 HOOK_EXIT_GRACE_MS），最后 SIGCONT 放行 ——
 *      放行在 `finally` 里，绝不能被异常跳过（理由见阶段 1 内注释：残留 T 态比泄漏更糟）；
 *   2. 同步等待后，对**仍然存活**的 pid 补 SIGKILL。
 * 先整批 SIGTERM 再统一等待，而不是逐个「SIGTERM+等待」——否则 N 个 hook 就要等
 * N × grace，退出耗时随 hook 数线性放大。
 *
 * 每个 pid 在发信号前先做 `process.kill(pid, 0)` 存活校验：已死的静默跳过，避免对
 * 已退出进程发信号。裸 pid 探测在这里就够了（与 #89824 需要「先探组、再探裸 pid」
 * 不同）——本文件的信号目标也是裸 pid，「pid 已死」等价于「没什么可杀」。
 *
 * pid 复用竞态：存活探测成功 → 实际发信号之间，目标进程恰好退出且 OS 把同一个 pid
 * 分配给了另一个无关进程，此时会误信号该进程。注意**不要**用「僵尸占位」来论证这里
 * 安全 —— libuv 装了 SIGCHLD handler 会自动 reap 子进程，退出的 hook pid 会立刻被
 * 释放（已实测：子进程退出 500ms 后 `ps` 已查无此进程、`kill(pid,0)` 抛 ESRCH）。
 * 真实情况是：① **注册 pid（子树根）由 SIGSTOP 成功兜住** —— 冻结成功即证明它此刻
 * 存在、且在快照期间不可能退出被复用，所以「以已复用的 pid 为根展开出无关进程整棵
 * 子树」这个最大误伤半径被结构性排除（这也是阶段 1 只遍历 frozen 而非 livePids 的
 * 原因）；② 后代 pid 来自同一次快照，快照与发信号之间仍存在窄窗口，理论上可误伤单个
 * 进程；③ 阶段 2 会重新探测一次。best-effort 兜底场景下可接受。
 *
 * 附带一个反直觉现象（勿据此优化掉阶段 2 的探测）：优雅期是**同步阻塞**，期间 JS
 * 不让出 event loop，libuv 因此无法处理 SIGCHLD 完成 reap。于是一个在优雅期内正常
 * 退出的 hook 在阶段 2 呈僵尸态（`Z+`），`kill(pid, 0)` 仍返回存活，SIGKILL 会打在
 * 僵尸上（无害 no-op，僵尸 pid 在被 reap 前也不可能复用）。
 */
export declare function killAllHooksSync(): void;
/** Reuse the exit algorithm for one host owner without touching other hooks. */
export declare function killHookPidsSync(ownedPids: ReadonlySet<number>): void;
