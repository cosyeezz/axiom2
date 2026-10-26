/**
 * 频道唤醒编排服务：依赖（JobStore / Daemon）在这里解析一次，工具不再各自 ContainerUtil.get。
 * 只做「落盘之后叫醒」，永远在目录锁外调用；单测直接 new + 赋字段即可。
 */
import { type IDaemonProcessManager } from '@genie/cbc-daemon';
import { Logger } from '@genie/telemetry';
import { type IJobStore } from '../agent-view/agent-view-protocol';
import { SettingsManager } from '../settings/settings-protocol';
import { type ChannelWakeSkipReason } from './agent-home-channel-wake';
import { type AgentHomeChannel, type AgentHomeChannelMessage, type AgentHomeDirectoryFile } from './agent-home-directory';
export interface ChannelWakeDeps {
    store?: IJobStore;
    processManager?: IDaemonProcessManager;
}
/**
 * 叫醒审计的两个回调（单一实现）：工具路径（ChannelWakeService）与 HTTP 路径
 * （local-agent-home-controller 的用户发言）共用，字段/文案不会各写一份。
 * 投递成功的语义是「信已经进了对方的 job 收件箱」，不代表对方已经开始处理。
 */
export declare function channelWakeAudit(input: {
    homeDir: string;
    channelId: string;
    actorAgentId?: string;
    messageId?: string;
    log?: (message: string) => void;
}): {
    onSkip: (agentId: string, reason: ChannelWakeSkipReason) => void;
    onDelivered: (agentId: string) => void;
};
export declare class ChannelWakeService {
    protected readonly injectedStore?: IJobStore;
    protected readonly injectedProcessManager?: IDaemonProcessManager;
    protected readonly settingsManager?: SettingsManager;
    protected readonly logger?: Logger;
    /** 注入优先；缺注入时退回容器（真实运行；单测没有容器也不会炸）。 */
    resolveDeps(): ChannelWakeDeps;
    /**
     * 发言落盘后的叫醒出口。返回 false = 拿不到 JobStore（只记日志，不影响发言结果）。
     * job worker 进程里 canRespawn 强制 false，只写信 + wake 票，避免双 fork。
     */
    wakeAfterSpeech(input: {
        homeDir: string;
        directory: AgentHomeDirectoryFile;
        channel: AgentHomeChannel;
        message: AgentHomeChannelMessage;
        /** speech 侧结果：没有推进轮次就别重复叫人。 */
        advancedTurn?: boolean;
        onSkip?: (agentId: string, reason: ChannelWakeSkipReason) => void;
    }): Promise<boolean>;
    /** 叫醒审计（onSkip / onDelivered 回调），供各路径在投递结果上落审计行。 */
    private audit;
    /** 自治总闸（Web UI 那个开关）关掉就不投递：票与轮次留在原地，开关打开后自然继续。 */
    private wakeAllowed;
    /** 任务事件等非发言路径的定向叫醒。返回 false = 开关关着或拿不到 JobStore。 */
    wakeMembers(input: {
        homeDir: string;
        directory: AgentHomeDirectoryFile;
        channel: AgentHomeChannel;
        text: string;
        from?: string;
        mentionNames?: string[];
        messageId?: string;
        onlyAgentIds?: readonly string[];
        excludeAgentId?: string;
        onSkip?: (agentId: string, reason: ChannelWakeSkipReason) => void;
    }): Promise<boolean>;
    /** 招人起 job 用的 logDir；工具拿不到容器时退化为默认。 */
    logDir(): string;
}
