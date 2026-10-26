/**
 * Agent Home 落盘式收件箱：**同事 job 收件箱**（`jobs/<id>/colleague-inbox/`）+
 * **唤醒票目录**（`agent-home/wake/`）+ 目录监听。
 *
 * 除了同事侧，这里还有**主 Agent 收件箱**（`agent-home/inbox/`）：主 Agent 虽然不进频道
 * 成员表（委托侧定位见 agent-home-membership），但它是**委托人**——同事可以用
 * `MessageColleague` 回报它、一批派单全部完成时 lead 也会回报它，所以这条边是活的
 * （入队 `enqueueMainAgentMail`，由 agent-home-main-inbox-consumer 在主会话空闲时投递）。
 * 别再照着旧注释以为可以整条删掉。
 */
export declare function agentHomeWakeDir(homeDir: string): string;
export declare function colleagueInboxDir(jobDir: string): string;
export declare function enqueueColleagueInbox(jobDir: string, text: string): Promise<void>;
export declare function drainColleagueInbox(jobDir: string): Promise<Array<{
    text: string;
}>>;
export declare function enqueueColleagueWake(homeDir: string, jobId: string): Promise<void>;
/** 先看票再叫醒，成功后再删。失败把文件留在盘上。 */
export declare function peekColleagueWake(homeDir: string): Promise<Array<{
    jobId: string;
    path: string;
}>>;
export declare function removeWakeTicket(path: string): Promise<void>;
/**
 * 主 Agent 收件箱（委托侧）：同事的回报/私信先落这里，主会话 idle 时由
 * agent-home-main-inbox-consumer 取走。落盘 = 窗口关着、进程重启都不丢；
 * 投递成功再删（与唤醒票同一条纪律）。
 */
export declare function agentHomeMainMailboxDir(homeDir: string): string;
export declare function enqueueMainAgentMail(homeDir: string, mail: {
    text: string;
    fromAgentId?: string;
    targetSessionId?: string;
}): Promise<void>;
/** 先看信再投递，成功后再删。失败把文件留在盘上，下一 tick 重试。 */
export declare function peekMainAgentMail(homeDir: string): Promise<Array<{
    text: string;
    fromAgentId?: string;
    targetSessionId?: string;
    path: string;
}>>;
export declare function removeMainAgentMail(path: string): Promise<void>;
/**
 * 已认领（取出处理中）目录：`agent-home/inbox/.processing/`。
 * 与同事收件箱同一套两阶段纪律：认领是 rename，确认（ack = removeMainAgentMail）才真删。
 */
export declare function agentHomeMainMailboxProcessingDir(homeDir: string): string;
/**
 * 认领租约（兜底）。正常路径走不到它：
 * - 认领者崩溃 → pid 已死 → **下一个 kick 立刻回收**；
 * - 认领者活着（哪怕正在跑一个很长的回合）→ 不抢，否则多窗口会重复投递。
 * 只有 pid 被复用 / 进程僵死（活着但永不 ack）才会等到这里，属极端兜底。
 */
export declare const MAIN_MAIL_CLAIM_LEASE_MS: number;
/** 派发失败后的重投退避：落 `.retry/`（**不在被 watch 的队列里**），到点由下一轮 claim 提升回队列。 */
export declare const MAIN_MAIL_RETRY_BACKOFF_MS = 5000;
/** 重投队列（退避期）：`agent-home/inbox/.retry/`。刻意不在 inbox 根下——那是被 fs.watch 盯着的目录。 */
export declare function agentHomeMainMailboxRetryDir(homeDir: string): string;
/**
 * 派发失败（或暂时拿不到 agent）的信：进重投队列等退避。**不能直接放回 inbox**——
 * 那是一次写盘，本进程的 fs.watch 立刻被叫醒 → 下一轮又派发又失败，实测 2 秒能打 40 次 run()。
 */
export declare function deferMainAgentMail(homeDir: string, path: string): Promise<void>;
/**
 * 认领主 Agent 邮箱（两阶段的第一阶段）：`inbox/*.json` rename 进 `inbox/.processing/<认领标记>`，
 * 并**回收无主残留**（上一轮认领后没确认、且认领者已死或超租约的信），一起返回。
 * 崩溃残留不丢（at-least-once，重复由 message_id 去重吸收）。
 *
 * rename 是原子操作：**多窗口共享同一个 HOME 时，同一封信只会被一个进程认领**——
 * 原先 peek 不改盘，两个进程能各自看到同一封并各投一遍。正在被活进程投递的信这一轮不回收。
 *
 * 解析不出 `text` 的文件（坏 JSON / 缺字段）不返回也不动它：与 peek 的跳过语义一致，
 * 它留在 .processing 里等人工排查，不会被当成待投递的信反复取。
 */
export declare function claimMainAgentMail(homeDir: string): Promise<Array<{
    text: string;
    fromAgentId?: string;
    targetSessionId?: string;
    path: string;
}>>;
/** 跳过目录：判等不可靠（旧格式无 message_id）且已在历史里的信放这儿——不删、也不再进队列。 */
export declare function agentHomeMainMailboxSkippedDir(homeDir: string): string;
/**
 * 旧格式（无 message_id）的信已在历史里：不再投，但判等会回落到「同发信人 + 同正文」，
 * 删了可能丢真信，所以**留盘**——但必须离开待取队列。
 *
 * 为什么不能像以前那样放回 inbox：那是一次写盘，本进程的 fs.watch 立刻被叫醒 →
 * 下一轮又认领又放回，实测 2 秒 40 轮、每轮还写一条审计，永远不收敛。
 */
export declare function skipMainAgentMail(homeDir: string, path: string): Promise<void>;
/** 隔离目录：认不出来的信放这儿（不删——用户可见的回报不能静默丢）。 */
export declare function agentHomeMainMailboxQuarantineDir(homeDir: string): string;
/**
 * 认不出的信移进隔离目录：**不丢**，但离开主队列（否则每个 tick 都重试、把队列堵死）。
 * 出队的原因是解析失败/格式过旧，调用方要落一条审计说明。
 */
export declare function quarantineMainAgentMail(homeDir: string, path: string): Promise<void>;
/** 信落到目录就叫醒（同事收件箱 / 唤醒票目录 / 主 Agent 邮箱共用）。事件去抖 25ms，避免一次落盘叫醒多次。 */
export declare function watchInboxDirectory(dir: string, onEvent: () => void): {
    dispose(): void;
};
