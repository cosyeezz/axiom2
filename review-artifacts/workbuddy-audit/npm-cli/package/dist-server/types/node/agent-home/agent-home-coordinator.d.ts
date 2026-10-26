/**
 * 每 HOME 一个「自治协调者」租约（跨进程单例）。
 *
 * 为什么需要：Agent Home 的状态按 HOME 共享（多窗口 / 多端口看同一个 Agent Home 是
 * 有意设计），但协调循环（2s 叫醒 tick、唤醒票 drain、轮次看门狗）原先按**进程类型**
 * 判 owner（`!getJobId() && HOST === 'web-ui'`）——于是每个 `--serve` 实例都是 owner。
 * 本机一度有 18 个实例在跑：18 份 2s tick 抢同一把目录锁，锁预算（10s）内抢不到的
 * **用户写操作**就被打了 500。
 *
 * 租约文件 `agent-home/coordinator.json` = `{ pid, heartbeatAt }`：
 * - 持有者每个 tick 续租（重写 heartbeatAt）；
 * - 其他实例**只读待命**，不跑循环（状态照旧共享，只是没人重复扫）；
 * - 心跳过期（TTL）或持有者 pid 已死 → 下一个 tick 抢过来（tmp + rename 原子替换）；
 * - 抢完再读一次确认自己是赢家，避免同 tick 两个实例都以为自己是协调者；
 *   冷启动那条路用**独占创建**（O_EXCL），建成即赢家，建不成的直接让出去。
 *
 * 没有它系统也能跑（目录锁保证不写坏），差别只是"N 个人轮流扫"还是"1 个人扫"。
 */
/**
 * 心跳多久算过期。tick 是 2s，给到 7s：容忍一次丢 tick + 定时器抖动，
 * 又不至于让"协调者被强杀"后空等太久（下一个 tick 就能接管）。
 */
export declare const COORDINATOR_TTL_MS = 7000;
/**
 * 冷启动宽限：O_EXCL 建成到内容写完之间有微秒级窗口，这期间别的实例会读到**空文件**。
 * 空且刚建的不当「坏文件」抢（抢了就是同 tick 双协调者），等下一 tick 再看；
 * 有内容的坏文件（半截 JSON）不受这条影响，照旧立即接管。
 */
export declare const COORDINATOR_CLAIM_GRACE_MS = 1000;
export interface AgentHomeCoordinatorLease {
    pid: number;
    heartbeatAt: number;
}
export declare function agentHomeCoordinatorPath(homeDir: string): string;
/** 读租约：文件不存在 / 坏行 / 字段不合法都当"没有租约"。 */
export declare function readAgentHomeCoordinatorLease(homeDir: string): Promise<AgentHomeCoordinatorLease | undefined>;
/**
 * 试图成为 / 保持协调者。
 * 返回 true = 本进程持有有效租约（可以跑自治循环）；false = 待命（别人在跑）。
 */
export declare function ensureAgentHomeCoordinator(homeDir: string, now?: number): Promise<boolean>;
