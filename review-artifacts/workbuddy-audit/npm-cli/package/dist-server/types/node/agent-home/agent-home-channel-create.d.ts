/**
 * 自治建频道 / 拉人：成员解析（id）、配额、lead、provenance、审计。
 *
 * 成员资格（与组队同一条，见 agent-home-membership）：**只有常驻同事能进**。
 * 主 Agent 是委托侧的工作现场（随进程生灭、上下文是用户私有的现场），它**建频道、
 * 派单、读板、发言**都可以，但**不进成员表**——所以"创建者自动进频道"对主 Agent 不成立，
 * lead 也就不能缺省给创建者：缺省给"第一个成员同事"。invite 同上（主 Agent 加不进来）。
 */
import { type AgentHomeChannel, type AgentHomeDirectoryFile, type AgentHomeProfile } from './agent-home-directory';
import type { AgentHomeCreateErrorCode } from './agent-home-errors';
type MemberResolution = {
    ok: true;
    profiles: AgentHomeProfile[];
} | {
    ok: false;
    error: 'MEMBER_NOT_FOUND';
};
/**
 * 成员引用一律是 **id**（对齐上游：`createGroup` / `setGroupMembers` 只吃 memberIds，
 * `SendToAgent` 的 target_id 文档原话就是 "not a name"）。显示名不是地址——名字只用于
 * 正文里的 @ 点名（撞名时同名的人全部叫上，见 agent-home-mentions）。
 * `only` 限定候选集（例：任务指派只能落在频道成员里）。
 */
export declare function resolveMemberRefs(directory: AgentHomeDirectoryFile, refs: readonly string[], options?: {
    only?: ReadonlySet<string>;
}): MemberResolution;
export interface CreateChannelInput {
    homeDir: string;
    /** 发起者 agentId（工具必有；用户经 HTTP 建频道走 controller，不经过这里）。 */
    creatorAgentId: string;
    name?: string;
    memberRefs: readonly string[];
    /** lead 引用（id）；缺省 = 创建者。 */
    leadRef?: string;
    now?: number;
}
export type CreateChannelResult = {
    ok: true;
    channel: AgentHomeChannel;
    members: AgentHomeProfile[];
    directory: AgentHomeDirectoryFile;
    /** 同一批人的频道已存在，直接复用了它（没有新建）。 */
    reused?: boolean;
    /** 复用的频道原先没有 lead，这次把请求的 lead 补上了。 */
    adoptedLead?: boolean;
} | {
    ok: false;
    error: AgentHomeCreateErrorCode;
};
/**
 * trim + 去重（保序）。成员名单 / @ 名单 / mention 列表都从它走——
 * 原先 speech 与 HTTP 各写一份，空串与重复的边界容易只在一侧处理。
 */
export declare function uniqueTrimmed(ids: readonly string[]): string[];
/** 成员集合是否相同（顺序无关；上游 isSameMemberSet）。HTTP 侧复用同一份。 */
export declare function isSameMemberSet(a: readonly string[], b: readonly string[]): boolean;
export declare function createAgentHomeChannel(input: CreateChannelInput): Promise<CreateChannelResult>;
export interface InviteToChannelInput {
    homeDir: string;
    channelId: string;
    actorAgentId: string;
    memberRefs: readonly string[];
    now?: number;
}
export type InviteToChannelResult = {
    ok: true;
    channel: AgentHomeChannel;
    added: AgentHomeProfile[];
    directory: AgentHomeDirectoryFile;
} | {
    ok: false;
    error: AgentHomeCreateErrorCode;
};
export declare function inviteAgentHomeChannelMembers(input: InviteToChannelInput): Promise<InviteToChannelResult>;
export {};
