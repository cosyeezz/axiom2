/**
 * 同事的 job：还没开口的同事怎么被拉起来（招人 / 叫醒两处共用）。
 *
 * 从 agent-home-channel-wake 挪出来——唤醒模块只该负责「叫谁、怎么投递」，
 * 不该顺带管"给一个人起 job、写 primaryJobId"。这里只做创建侧的事：
 * 锁内规划 → 锁外 spawn → 锁内认领（拿不到就回收刚起的 job）。
 *
 * 不要写 channel.id 进 jobAssignments；默认 Agent / 极简不走这里。
 */
import { type AgentViewActionDeps } from '../agent-view/agent-view-actions';
import type { IJobStore } from '../agent-view/agent-view-protocol';
import { type AgentHomeDirectoryFile, type AgentHomeProfile } from './agent-home-directory';
/**
 * 「现在能不能给这个人起 job」的唯一判据（规划阶段与锁外 spawn 后的认领阶段共用）。
 *
 * 认领阶段要再问一次，是因为锁外 spawn 期间目录可能已经变了（别人先给他起了 job /
 * 他被删了 / 被改成极简）。两处必须同一组条件，否则会出现"规划说能起、认领说不行"
 * 的错配——那正是回收分支存在的原因。
 */
export type ColleagueJobVerdict = {
    kind: 'spawn';
    profile: AgentHomeProfile;
} | {
    kind: 'existing';
    id: string;
} | {
    kind: 'blocked';
};
export declare function planColleagueJob(directory: AgentHomeDirectoryFile | undefined, agentId: string): ColleagueJobVerdict;
/**
 * 幽灵对账循环（目录锁内调用，就地清理传入的目录副本；调用方负责在真的清到东西时落盘）。
 *
 * 为什么是循环：同一人名下可能攒了不止一条幽灵——每次 Run 被删都会留一条映射。
 * 只清一条时 planColleagueJob 会解出**下一条**幽灵 id，ensure 把它当 existing 原样返回，
 * 调用方拿它投递/重启照样失败。每轮 forgetJobId 至少摘掉一条映射（清不动就原样交回判据），
 * 必然收敛；清完仍解不出来 = 名下确实有多个存活 Run 的歧义 → blocked。
 */
export declare function reconcileGhostJobIds(input: {
    directory: AgentHomeDirectoryFile;
    agentId: string;
    /** 由调用方注入（真实现读 JobStore；spec 直接给判定表）。 */
    isGhost: (jobId: string) => Promise<boolean>;
}): Promise<{
    verdict: ColleagueJobVerdict;
    cleaned: string[];
}>;
export declare function ensureAgentHomeColleagueJob(input: {
    homeDir: string;
    agentId: string;
    store: IJobStore;
    processManager: AgentViewActionDeps['processManager'];
    logDir?: string;
}): Promise<string | undefined>;
