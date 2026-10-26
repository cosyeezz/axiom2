/**
 * 活人：写进 job inbox，让已经在跑的 JobInboxConsumer 取走。
 * 死人：enqueueReply 再 respawn / 叫醒票。不在 resume 期强行 run()。
 * 信封不能当 --resume 位置参数。
 */
import { type IDaemonProcessManager } from '@genie/cbc-daemon';
import { type IJobStore } from '../agent-view/agent-view-protocol';
/**
 * 同事 job 的进程还活着吗。判活只有一份实现（目录锁 / 协调者租约 / 这里共用）：
 * `kill(0,0)` / `kill(-1,0)` 在 Unix 上不是「这个同事还活着」。
 */
export declare function isColleagueJobPidAlive(pid: number | undefined): boolean;
export declare function respawnColleagueJob(store: IJobStore, jobId: string, processManager?: IDaemonProcessManager, options?: {
    resumeStopped?: boolean;
}): Promise<boolean>;
/**
 * 记下"这件活在哪个主会话里被起（或被叫起来）"：同事回投主 Agent 时按它寻址，
 * 信就落在那个会话的上下文里，而不是"谁先 tick 谁拿"。
 *
 * 解析不出会话（后台 tick / 没有当前会话）就不写 —— 信会按活跃会话启发式投，不丢。
 * 已经记过就保持不动（见下面的"只写一次"）。
 */
export declare function noteColleagueJobOrigin(store: IJobStore, jobId: string, homeDir: string): Promise<void>;
/** 这个同事 job 的回投地址（没记过 / 读不到 = undefined）。 */
export declare function readColleagueJobOrigin(jobId: string | undefined): Promise<string | undefined>;
/**
 * 投递结果：
 * - `delivered`：信已经进了活着的收件箱（对方进程会自己消费），或本次重拉成功；
 * - `deferred`：信写进了收件箱，但对方进程不在、本次也没拉起来 —— 只留了唤醒票等
 *   broker 拉起。**不等于送达**（现场误判过一次：任务指派后审计全是 delivered，
 *   实际被指派人从未被拉起，见 #118277）。
 * - `skipped-*`：一个字节都没写（原因会进审计）。
 */
export type ColleagueDelivery = 'delivered' | 'deferred' | 'skipped-user-stopped' | 'skipped-dead' | 'skipped-flood';
export declare function deliverToColleagueJob(input: {
    store: IJobStore;
    jobId: string;
    text: string;
    homeDir: string;
    canRespawn: boolean;
    respawn?: (jobId: string) => Promise<boolean>;
    /** 用户显式点名时允许把"用户终止过"的同事重新拉起；自动唤醒不允许。 */
    resumeStopped?: boolean;
    /**
     * true = 对方进程不在就**不投递**（不写信、不 respawn、不留票）。
     * 成员之间 @ 用这个：信留在频道 transcript 里（事实源），等它下次被叫起来自己读；
     * 只有用户发言才值得把一个死人拉起来。
     */
    skipIfDead?: boolean;
}): Promise<ColleagueDelivery>;
/**
 * 入队预算（进程内滑动窗口）：同一个 job 在 10 分钟内最多收这么多条频道/同事信封。
 *
 * 超了**丢掉这条"提示"**——不丢信息：频道 transcript 才是事实源，对方下次被叫起来自己会读。
 * 用户消息不走这条路径，永远不会被丢；进程内计数是"兜底"，不是精确配额（多进程各自计数）。
 */
export declare const MAX_ENVELOPES_PER_JOB = 20;
export declare const ENVELOPE_WINDOW_MS: number;
/** 单测用：清空窗口计数（模块级状态，跨用例会互相污染）。 */
export declare function resetEnvelopeBudgetForTests(): void;
/** 单测用：窗口表当前键数（钉住"键不会只增不减"，见 ENVELOPE_WINDOW_MAX_JOBS）。 */
export declare function __envelopeWindowKeyCountForTests(): number;
/**
 * 投递到主 Agent（委托侧）：**只落盘**，不做注入。
 *
 * 主会话活在 serve 进程里、由 agent-home-main-inbox-consumer 在它 idle 时取走；
 * 窗口关着 / 进程重启都不丢——这正是它必须落盘、不能进内存队列的原因。
 * 用信封装（和同事那条一样），主会话收到的是 action=incoming 的回执，不是用户打字。
 */
export declare function deliverToMainAgent(input: {
    homeDir: string;
    text: string;
    fromAgentId?: string;
    /** 收件会话 = 这件活在哪个主会话里被起（见 noteColleagueJobOrigin）；缺省走启发式投。 */
    targetSessionId?: string;
}): Promise<'delivered'>;
