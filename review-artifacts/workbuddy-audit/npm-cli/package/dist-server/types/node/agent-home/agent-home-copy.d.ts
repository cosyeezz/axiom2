/** Agent Home 提示词文案。无 fs。不是 directory 的副本。 */
import type { AgentHomeChannelTaskEventPayload } from './agent-home-channel-task-event';
interface Named {
    id: string;
    name: string;
}
export declare function formatChannelReceiptHow(): string;
/**
 * 主 Agent 的组队玩法提示。
 *
 * 默认 Agent 不进房间、没频道时，attachRoomRoster 里的房间/频道两段都是空的，
 * 模型完全不知道 Agent Home 能「自己拉人、建频道」——于是用户说「组团」时
 * 它只会用 Task 子代理。这里在没有任何房间/频道时也挂一条，把三个工具点名。
 */
export declare function formatAgentHomeTeamPlaybook(colleagues: readonly Named[], options?: {
    viaRepl?: boolean;
    maxNames?: number;
}): string;
export declare function formatColleagueReceiptHow(recipient?: string): string;
/** 给人看的名字在前；id 只标给工具参数，不当称呼（名册 / 列表都用它，别各自拼字符串）。 */
export declare function homePersonRef(person: Named): string;
export declare function formatAgentHomeSelfIdentity(self?: Named | null, options?: {
    defaultAgentId?: string | null;
    members?: readonly Named[];
}): string;
export declare function formatAgentHomeChannelRoster(channels: readonly Named[], options?: {
    viaRepl?: boolean;
    self?: Named | null;
    defaultAgentId?: string | null;
}): string;
export declare function formatAgentHomeChannelReminder(channelName: string, options?: {
    viaRepl?: boolean;
    from?: string;
    speakerName?: string;
    channelId?: string;
    self?: Named | null;
    defaultAgentId?: string | null;
    members?: readonly Named[];
}): string;
export declare function formatAgentHomeRoomReminder(scopes: readonly {
    groupName: string;
    contacts: readonly Named[];
}[], selfName: string, options?: {
    viaRepl?: boolean;
    selfId?: string;
    defaultAgentId?: string | null;
}): string;
/** 任务板事件行：结构化事件 → 频道 timeline 上的一行系统消息。 */
export declare function formatChannelTaskEventText(event: AgentHomeChannelTaskEventPayload, nameOf: (agentId: string) => string): string;
/**
 * 频道侧栏预览行：与 formatChannelTaskEventText 同一份文案，但 batch_done 只取首句——
 * 完整文案的尾段是给模型的操作指令（"用 MessageColleague…"），进用户可见的预览不合适。
 */
export declare function formatChannelTaskEventPreview(event: AgentHomeChannelTaskEventPayload, nameOf: (agentId: string) => string): string;
interface BoardTask {
    id: string;
    subject: string;
    status: string;
    ownerId?: string;
    assigneeId?: string;
    stalled?: boolean;
    wakeCounts?: Record<string, number>;
}
export interface ChannelBoardBriefOptions {
    /** 被叫醒的人。没有 = 不注入看板。 */
    selfId?: string;
    /** 频道 lead；等于 selfId 时给完整快照。 */
    leadAgentId?: string;
    nameOf: (agentId: string) => string;
}
/**
 * 看板注入：**一段文案、两种详略**。注入点只有一处（被叫醒的那一轮），
 * lead 拿完整快照（推模式，要它编排），成员拿一行概览 + 自己的活（拉模式，
 * 自己 list 要明细，省上下文）。空板 / 没有 selfId 都返回空串。
 */
export declare function formatChannelBoardBrief(tasks: readonly BoardTask[], options: ChannelBoardBriefOptions): string;
export {};
