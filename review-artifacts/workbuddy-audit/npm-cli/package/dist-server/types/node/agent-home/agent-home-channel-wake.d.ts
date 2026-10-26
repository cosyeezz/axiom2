/** 落盘后叫醒频道成员。用户发言全员；同事发言只叫 @。 */
import type { IDaemonProcessManager } from '@genie/cbc-daemon';
import type { IJobStore } from '../agent-view/agent-view-protocol';
import { type AgentHomeChannel, type AgentHomeChannelMessage, type AgentHomeDirectoryFile } from './agent-home-directory';
/** 唤醒被跳过时给审计的原因（写进 audit.jsonl 的 wake_skipped）。 */
export type ChannelWakeSkipReason = 'no-job' | 'error' | 'user-stopped' | 'dead' | 'flood' | 'deferred';
/** 落盘成功后的叫醒出口：HTTP 回车和 SpeakInChannel 共用。 */
export declare function wakeAfterChannelSpeech(input: {
    directory: AgentHomeDirectoryFile;
    channel: AgentHomeChannel;
    message: AgentHomeChannelMessage;
    /** speech 侧的结果：这次发言有没有推进轮次。false = 别叫人（待发言的人早就叫过了）。 */
    advancedTurn?: boolean;
    homeDir: string;
    store: IJobStore;
    processManager?: IDaemonProcessManager;
    canRespawn?: boolean;
    reloadDirectory?: () => Promise<AgentHomeDirectoryFile | undefined>;
    onSkip?: (agentId: string, reason: ChannelWakeSkipReason) => void;
    onDelivered?: (agentId: string) => void;
    log?: (message: string) => void;
}): Promise<void>;
/**
 * 同事在频道里 @ 了名册里的分身（主 Agent）：投一封信到主邮箱，由主会话 idle 时读到
 * 并决定要不要用 SpeakInChannel 回话。分身不在叫醒池、不占轮次，这是它唯一的入站边。
 * 用户自己的发言不投（那就是分身本人在说话）；投递失败只记日志，不影响叫醒同事。
 */
export declare function notifyTwinMention(input: {
    homeDir: string;
    directory: AgentHomeDirectoryFile;
    channel: AgentHomeChannel;
    message: AgentHomeChannelMessage;
    log?: (message: string) => void;
}): Promise<boolean>;
export declare function wakeChannelMembers(input: {
    directory: AgentHomeDirectoryFile;
    channel: AgentHomeChannel;
    text: string;
    /** 说话人：user 或成员 agentId。 */
    from?: string;
    mentionNames?: string[];
    messageId?: string;
    /** 这条发言带的附件：信封会带绝对路径（只给名字同事读不到，会去磁盘翻同名旧图）。 */
    attachments?: readonly {
        name: string;
        file: string;
    }[];
    /** 轮转标记（如 "3/10"）：这封是轮到你发言，不是被 @。 */
    round?: string;
    homeDir: string;
    store: IJobStore;
    processManager?: IDaemonProcessManager;
    /** 拉起接缝：默认走 respawnColleagueJob + processManager；单测注入假实现。 */
    respawn?: (jobId: string, options?: {
        resumeStopped?: boolean;
    }) => Promise<boolean>;
    /** 默认 true。job worker 里应 false，只写信 + wake 票，避免双 fork。 */
    canRespawn?: boolean;
    /**
     * 对方进程已死时**干脆不投**。默认 false：正常频道轮转与显式 @ 必须把信写入
     * inbox 并留 wake ticket，让中央 broker 拉起被空闲回收的成员。仅用于调用方明确
     * 只做在线 best-effort 通知的场景；不要按 `from === 'agent'` 自动开启，否则全员轮转
     * 会在第一位之后静默断链。
     */
    skipIfDead?: boolean;
    /** 没开过 1:1 时按招人同一条路起 job，写上 primaryJobId。不要把 channel.id 写进 jobAssignments。 */
    ensureJob?: (agentId: string) => Promise<string | undefined>;
    onSkip?: (agentId: string, reason: ChannelWakeSkipReason) => void;
    /** 投递成功回调：信已经进对方的 job 收件箱。 */
    onDelivered?: (agentId: string) => void;
    /** 说话人自己不要再吃一封自己的入站。 */
    excludeAgentId?: string;
    /**
     * 只叫醒这些成员（仍会去掉 exclude）。
     * 不传 = 全员。传 [] = 谁也不叫（同事没 @ 任何人）。
     */
    onlyAgentIds?: readonly string[];
    /**
     * 这条消息里**用户真正 @ 到的人**（与 onlyAgentIds 不是一回事：用户发言开一轮时
     * 只叫指针第一位，但那位不一定是被 @ 的）。
     * 只用来判"要不要把被用户终止过的同事重新拉起"。不传 = 退回 onlyAgentIds（工具侧
     * 的定向叫醒本来就只有这一份名单）。
     */
    mentionedAgentIds?: readonly string[];
    /** 每人投递前再读一次目录，避免解锁后 primary 被改派。 */
    reloadDirectory?: () => Promise<AgentHomeDirectoryFile | undefined>;
    /**
     * 这是不是**自动链**（成员发言触发的那一棒）：是则过互叫护栏（同轮去重 + 窗口限速）。
     * 用户发言 / @ 点名 / 派单不传，不受限。
     */
    autoWake?: boolean;
}): Promise<ChannelWakeOutcome>;
/**
 * 一次叫醒的结果（调用方据此决定"这一棒要不要当场交给下一位"）。
 *
 * - `delivered`：信真的进了对方 job 收件箱且人活着（或被拉起来了）。
 * - `unreachable`：**这次没送到、而且不会再送到**（dead / no-job / user-stopped）——
 *   轮次接力看到自己那一棒落在这里，就必须当场推进指针，不能等看门狗
 *   （看门狗只在 `--serve` 表面进程里跑；TUI / 页面关掉时根本没人兜底）。
 * - `deferred` 不进 unreachable：信已入收件箱 + 留了唤醒票，人起来自己会读，
 *   推进指针反而会让他醒来发现"不是我的棒"。
 */
export interface ChannelWakeOutcome {
    delivered: string[];
    unreachable: string[];
}
/** 叫醒计划：叫谁（已按叫醒池过滤）+ 这封要不要带轮次标记。 */
export interface ChannelWakePlan {
    targets: string[];
    /** 轮次标记（如 "1/3 · 2/10"）。没有进行中的轮次、或这次发言没推进轮次时不带。 */
    round?: string;
}
/**
 * 叫醒判定 —— **唯一一份**。HTTP 回执（要回 wokeAgentIds）与投递
 * （wakeAfterChannelSpeech）都调它；两边输入相同，结论就相同，不存在"两处要保持一致"。
 */
export declare function planChannelWake(input: {
    directory: AgentHomeDirectoryFile;
    channel: AgentHomeChannel;
    /** 说话人：'user' 或成员 agentId。 */
    from?: string;
    mentionAgentIds?: readonly string[];
    /** speech 侧结果：这次发言有没有推进/开启轮次。false = 待发言的人早叫过了，别重复叫。 */
    advancedTurn?: boolean;
    /** 说话人自己不吃自己的入站。 */
    excludeAgentId?: string;
}): ChannelWakePlan;
