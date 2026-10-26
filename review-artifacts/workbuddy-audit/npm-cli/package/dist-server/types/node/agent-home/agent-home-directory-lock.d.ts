/**
 * directory.json 跨进程锁。控制器 withLock 和 SpeakInChannel 共用。
 * 进程内排队 + mkdir 锁目录。
 *
 * 约定：
 * - 没拿到锁不要在 finally 里 rm 别人的锁目录。
 * - 过期只在持有者 pid 已死时拆；不靠 mtime 抢活锁。
 * - mkdir 成功但 pid 文件还没写 / 还是空的：等，不要当无主拆。
 * - 可重入只限当前异步上下文（AsyncLocalStorage），并发 withLock 必须排队。
 * - 释放时只删自己 pid 的锁。
 */
/**
 * 抢不到目录锁（预算内没等到）。**抛这个错时什么都没写**，所以调用方可以放心重试：
 * HTTP 层映射成 503 + Retry-After，前端只对这一类失败自动重试。
 */
export declare class AgentHomeDirectoryBusyError extends Error {
    readonly lockDir: string;
    constructor(lockDir: string);
}
/** 进程还活着吗（给锁与协调者租约共用；kill(0) 的坑见 deliver 侧注释）。 */
export declare function pidLooksLive(pid: number): boolean;
export declare function withAgentHomeDirectoryLock<T>(homeDir: string, task: () => Promise<T>): Promise<T>;
