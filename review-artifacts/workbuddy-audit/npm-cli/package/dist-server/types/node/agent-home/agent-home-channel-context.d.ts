/** 频道上下文解析（只读免锁）：工具与 HTTP 共用「读目录 → 认自己 → 找频道 → 列成员」，只给结构化错误码。 */
import { type AgentHomeChannel, type AgentHomeDirectoryFile, type AgentHomeProfile } from './agent-home-directory';
export type AgentHomeChannelContextError = 'DIRECTORY_UNAVAILABLE' | 'INVALID_ACTOR' | 'CHANNEL_NOT_FOUND' | 'CHANNEL_NEED_ID';
export interface AgentHomeSelfContext {
    directory: AgentHomeDirectoryFile;
    self: AgentHomeProfile;
}
export type ResolveAgentHomeSelfResult = {
    ok: true;
    context: AgentHomeSelfContext;
} | {
    ok: false;
    error: 'DIRECTORY_UNAVAILABLE' | 'INVALID_ACTOR';
};
export interface ResolveAgentHomeChannelContextInput {
    homeDir: string;
    jobId?: string;
    /**
     * 会话 id：execute 路径必须与 isEnabled 同源，否则会出现「工具可见但执行时说你不是
     * 任何频道的成员」（#125667 F1）。
     */
    sessionId?: string;
    /** 频道 id；不传 = 唯一频道。 */
    channelRef?: string;
    /** 调用方已读过目录时传入，省一次读盘（必须是同一 homeDir 的最新快照）。 */
    directory?: AgentHomeDirectoryFile;
    /**
     * 身份解析策略；**动作路径（execute）必须传 false**（见 ResolveMeAsAgentOptions）。
     * 缺省 = 可见性语义（认不出时回落默认 Agent），只给"工具在不在"这类判据用。
     */
    fallbackToDefault?: boolean;
}
export type ResolveAgentHomeChannelContextResult = {
    ok: true;
    directory: AgentHomeDirectoryFile;
    self: AgentHomeProfile;
    channel: AgentHomeChannel;
    members: AgentHomeProfile[];
    /** 自己可见的全部频道（错误提示与「你在哪几个频道」用）。 */
    channels: AgentHomeChannel[];
} | {
    ok: false;
    error: AgentHomeChannelContextError;
    channels: AgentHomeChannel[];
};
/**
 * 认自己：没有 job 映射就是默认 Agent；目录读不到 / 认不出都是错误。
 *
 * `fallbackToDefault: false` = 动作路径：只有**登记过归属的 job**（真同事）解析不出来
 * 时才回 INVALID_ACTOR；没归属的 job 是用户自己的会话，照常认成默认 Agent（见
 * ResolveMeAsAgentOptions）。调用方据此给出 `agentHomeMissingIdentityMessage()`。
 */
export declare function resolveAgentHomeSelfContext(input: {
    homeDir: string;
    jobId?: string;
    /** 会话 id：jobId 缺失或未认领时靠 sessionAssignments 认自己（见 #125667）。 */
    sessionId?: string;
    directory?: AgentHomeDirectoryFile;
    /** 见 ResolveMeAsAgentOptions：动作路径传 false，可见性路径缺省。 */
    fallbackToDefault?: boolean;
}): Promise<ResolveAgentHomeSelfResult>;
/**
 * 「这个会话没有 Agent Home 身份」的拒绝文案（动作路径专用）。
 *
 * 未认领 job 的可见性是放行的（工具在），但动作必须真实身份：默认 Agent = 用户，
 * 拿它发言会落成用户发言（越权 + 开一轮唤醒全员）、私信会冒名、改板会让 owner
 * 校验失效。给一句可执行的话，别让模型反复重试同一个动作。
 */
export declare function agentHomeMissingIdentityMessage(): string;
export declare function membersOfChannel(directory: AgentHomeDirectoryFile, channel: AgentHomeChannel): AgentHomeProfile[];
/**
 * 认自己 + 在自己可见的频道里找 channelRef。
 * 动作路径（execute）必须传 `fallbackToDefault: false`：认不出身份时宁可 INVALID_ACTOR，
 * 也不能顶着默认 Agent（= 用户）去改板 / 发言。
 */
export declare function resolveAgentHomeChannelContext(input: ResolveAgentHomeChannelContextInput): Promise<ResolveAgentHomeChannelContextResult>;
