/**
 * 主邮箱旁的「活跃主会话」指针：`agent-home/main-session.json`。
 *
 * 多进程共享同一个 HOME（几个 TUI / Web UI serve / 同事 job 的宿主）时，主邮箱只有一份、
 * 信里也没有目标会话（同事根本不知道你有几个会话）。于是用这个指针回答"该投给谁"：
 * **最近有用户发言的那个会话**。指针由各进程在 drain 时单调推进（`at` 更大才写），
 * 读失败 / 缺失 = 没有活跃会话（不拦投递）。
 *
 * 注意：这个文件刻意**不在** `agent-home/inbox/` 里 —— 那个目录被 fs.watch 盯着，
 * 且扫描时会把根下所有 `*.json` 当信取走。
 */
export interface ActiveMainSession {
    sessionId: string;
    /** 该会话最后一条用户发言的时间（ms）。 */
    at: number;
}
/** 未来时间戳的容忍窗口（时钟偏移）；超出即视为坏数据。 */
export declare const FUTURE_SKEW_MS: number;
export declare function agentHomeMainSessionPath(homeDir: string): string;
export declare function readActiveMainSession(homeDir: string): Promise<ActiveMainSession | undefined>;
/**
 * 解析"发起这件事的会话"（信的收件地址）：
 * - 优先**当前会话** —— 调用发生在某个会话的上下文里（主 Agent 在会话 A 里给同事派活、
 *   在会话 A 的任务板上建任务），要的就是 A；
 * - 回落**活跃会话指针**（后台 tick 触发的唤醒，进程里没有"当前在跑的会话"）；
 * - 都没有 = 没地址，信按启发式投（见 agent-home-main-mail-gate.ts）。
 */
export declare function resolveOriginSessionId(homeDir: string): Promise<string | undefined>;
/**
 * 记活跃会话。只在 `at` 前进时写盘（两个进程并发时后写者赢，但 `at` 单调不回退）。
 * 返回是否真的写了（测试与排查用）。
 */
export declare function noteActiveMainSession(homeDir: string, input: ActiveMainSession): Promise<boolean>;
/**
 * 默认 Agent 的 lastActiveAt 投影：主会话最近一次用户发言时间（指针的 `at`）。
 *
 * 默认 Agent 不认领 job（assignJob 明确拒绝），没有别的活跃链，档案里的
 * lastActiveAt 永远不写 —— 不投影的话侧栏把它回落显示成 createdAt（很像"时间虚假"）。
 * 只投影、不写盘：活跃来自别的进程（TUI 发言），写目录要跟 SpeakInChannel 抢同一把锁。
 */
export declare function projectDefaultAgentLastActive<T extends {
    id: string;
    lastActiveAt?: number;
}>(agents: T[], defaultAgentId: string | null | undefined, activeAt: number | undefined): T[];
