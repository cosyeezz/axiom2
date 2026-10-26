/**
 * Agent Home HTTP 共用：锁、常量、成员规范化。
 * 写盘一律 withAgentHomeDirectoryLock（和 SpeakInChannel 同一把）。
 */
import { Context } from '@celljs/web/lib/node';
import { type IDaemonProcessManager } from '@genie/cbc-daemon';
import { Logger } from '@genie/telemetry';
import { type AgentHomeChannelTaskRef } from '../../agent-home/agent-home-channel-tasks';
import { type AgentHomeDirectoryFile, type AgentHomeGroup, type AgentHomeProfile } from '../../agent-home/agent-home-directory';
import { AGENT_HOME_NAME_MAX, AGENT_HOME_TEXT_MAX, CHANNEL_MAX_MEMBERS, CHANNEL_MIN_MEMBERS, GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS, TASK_SUBJECT_MAX } from '../../agent-home/agent-home-limits';
import { type AgentHomeCapabilityState } from '../../agent-home/agent-home-settings';
import { type IJobStore } from '../../agent-view/agent-view-protocol';
import type { SettingsManager } from '../../settings/settings-protocol';
import type { IGatewayAuthMiddleware } from '../gateway-protocol';
/** 任务标题上限对 controller 保持同名导出（真源在 agent-home-limits）。 */
export { TASK_SUBJECT_MAX };
export { AGENT_HOME_NAME_MAX, AGENT_HOME_TEXT_MAX, CHANNEL_MAX_MEMBERS, CHANNEL_MIN_MEMBERS, GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS, };
export interface CreateAgentRequest {
    name?: unknown;
    /** 只认 'auto'：name 是占位名，主对话生成标题后自动换掉；改档案（PATCH）不读。 */
    nameSource?: unknown;
    /** 用户选定的几何头像；非法值回落到服务端自动挑款。 */
    avatarVariant?: unknown;
    title?: unknown;
    description?: unknown;
    engine?: unknown;
    /** 这个同事固定跑的模型 / 权限模式（建人时定，启 job 时拼进 argv）。 */
    model?: unknown;
    permissionMode?: unknown;
    homeCwd?: unknown;
}
export interface UpdateAgentRequest extends CreateAgentRequest {
    visibility?: unknown;
    /** 仅默认 Agent：分身能否加入房间/频道。 */
    joinTeams?: unknown;
    /** { mode: 'append' | 'replace', text } | null（null / 空正文 = 清空）。 */
    systemPrompt?: unknown;
    primaryJobId?: unknown;
    sectionId?: unknown;
    unreadByUser?: unknown;
    unreadIf?: unknown;
}
export interface CreateSectionRequest {
    name?: unknown;
}
export interface UpdateSectionRequest {
    name?: unknown;
    sortIndex?: unknown;
}
export interface AssignJobRequest {
    jobId?: unknown;
}
export interface CreateGroupRequest {
    name?: unknown;
    memberAgentIds?: unknown;
    homeCwd?: unknown;
}
export interface UpdateGroupRequest extends CreateGroupRequest {
    visibility?: unknown;
    pinned?: unknown;
    sortIndex?: unknown;
    unreadByUser?: unknown;
    lastPreview?: unknown;
    activeTeamName?: unknown;
}
export interface CreateChannelRequest {
    name?: unknown;
    memberAgentIds?: unknown;
}
export interface UpdateChannelRequest extends CreateChannelRequest {
    visibility?: unknown;
    pinned?: unknown;
    sortIndex?: unknown;
    unreadByUser?: unknown;
    unreadIf?: unknown;
    lastPreview?: unknown;
    sectionId?: unknown;
}
export interface PostChannelMessageRequest {
    /** 引用某条消息（短地址 #xxxxxxxx 或消息 id）。 */
    replyTo?: string;
    text?: unknown;
    from?: unknown;
    agentId?: unknown;
    mentionAgentIds?: unknown;
    /** 已上传到频道附件目录的附件（客户端回传 file，见 normalizeUserAttachments）。 */
    attachments?: unknown;
}
export interface CreateChannelTaskRequest {
    subject?: unknown;
    detail?: unknown;
    assignAgentId?: unknown;
    refs?: unknown;
    requestId?: unknown;
}
export interface CompleteChannelTaskRequest {
    refs?: unknown;
}
/** PATCH 语义：只改传了的字段；`null` 表示清空（细节 / 取消指派）。 */
export interface UpdateChannelTaskRequest {
    subject?: unknown;
    detail?: unknown;
    assignAgentId?: unknown;
    /** 整表替换（加 / 删引用都在客户端算）；空数组 = 清空。 */
    refs?: unknown;
}
export interface MoveChannelTaskRequest {
    /** 目标位次（同一分组内；越界由 domain 收敛到两端）。 */
    toIndex?: unknown;
}
/** 任务引用：只收合法 kind + 非空 value，最多 20 条（kind 白名单与 domain 共用 tasks 那份）。 */
export declare function normalizeTaskRefs(value: unknown): AgentHomeChannelTaskRef[];
export interface AgentHomeHost {
    auth: IGatewayAuthMiddleware;
    logger: Logger;
    store: IJobStore;
    processManager?: IDaemonProcessManager;
    withLock<T>(task: () => Promise<T>): Promise<T>;
    loadOrBootstrap(): Promise<AgentHomeDirectoryFile>;
    save(directory: AgentHomeDirectoryFile): Promise<void>;
    requireEnabled(ctx: Context): Promise<boolean>;
    pruneGroupsForAgent(directory: AgentHomeDirectoryFile, agentId: string): void;
    pruneChannelsForAgent(directory: AgentHomeDirectoryFile, agentId: string): void;
    removeChannelTranscript(channelId: string): Promise<void>;
    readChannelMessages(channelId: string): Promise<import('../../agent-home/agent-home-directory').AgentHomeChannelMessage[]>;
    beginSse(ctx: Context): void;
    writeSseEvent(ctx: Context, event: string, data: unknown): void;
}
export declare function soleGroup(directory: AgentHomeDirectoryFile): AgentHomeGroup | undefined;
export declare function unionMemberIds(current: readonly string[], incoming: readonly string[]): string[];
export declare function asTrimmedString(value: unknown, max: number): string | undefined;
export declare function applyUnreadPatch(target: {
    unreadByUser?: number;
}, unreadByUser: unknown, unreadIf: unknown): void;
export declare function looksAutoNamed(name: string, intent: string | undefined): boolean;
export declare function normalizeMemberIds(value: unknown): string[] | undefined;
/** 客户端回传的附件项：只认落盘名（file），name 仅作展示名提示。 */
export interface UserChannelAttachmentInput {
    file: string;
    name?: string;
}
export type NormalizeUserAttachmentsResult = {
    ok: true;
    items: UserChannelAttachmentInput[];
} | {
    ok: false;
    reason: string;
};
/**
 * 收窄客户端回传的附件列表（POST /channels/:id/messages 的 body.attachments）。
 *
 * 客户端给的 `{name,file,mime,size}` 一个字段都不当权威：这里只取 `file`（必须是
 * 服务端上传时给的内容寻址名，白名单见 normalizeChannelAttachmentFile）与可选的展示名，
 * 去重保序；**超量整条拒**而不是静默截断（客户端自己已封顶 4 个，到这儿就是 bug）。
 * size/mime 由 controller 侧用真实文件重算。
 */
export declare function normalizeUserAttachments(value: unknown): NormalizeUserAttachmentsResult;
/** 成员集合相等：domain 只有一份实现（isSameMemberSet），这里保留名字给本层调用。 */
export declare function sameMemberSet(a: readonly string[], b: readonly string[]): boolean;
export declare function defaultGroupName(members: readonly AgentHomeProfile[]): string;
export declare function pruneGroupsForAgent(directory: AgentHomeDirectoryFile, agentId: string): void;
export declare function pruneChannelsForAgent(directory: AgentHomeDirectoryFile, agentId: string, dropTranscript: (channelId: string) => void): void;
export declare function withHomeLock<T>(task: () => Promise<T>): Promise<T>;
export declare function saveDirectory(directory: AgentHomeDirectoryFile): Promise<void>;
export declare function isAgentHomeHttpEnabled(settingsManager: SettingsManager): Promise<boolean>;
/**
 * HTTP 面的一次性判定：宿主闸 + 目录表面，并带回同一份设置算出的自治状态，
 * 让目录响应里的 enabled 与 orchestration* 不会出自两次读盘。
 */
export declare function resolveAgentHomeHttpState(settingsManager: SettingsManager): Promise<{
    enabled: boolean;
    capability: AgentHomeCapabilityState;
}>;
/**
 * 旧目录的 Agent 档案没有 model/permissionMode，但它的主 Job 已把真实启动值
 * 保存在 respawnArgs。目录第一次读取时只补缺失字段，绝不覆盖新档案的显式值。
 */
export declare function backfillAgentRuntimePreferences(directory: AgentHomeDirectoryFile, store: IJobStore, logger?: Pick<Logger, 'warn'>): Promise<boolean>;
export declare function loadOrBootstrapDirectory(store: IJobStore, logger: Logger, options?: {
    /**
     * 首次建目录时要不要把用户命名、仍在跑的 job 收编成同事。收编后该 job 就被认作
     * 同事 job（记忆分区等随之改变），所以自治关着时不收编，终端里起的 job 保持原样。
     */
    promoteJobs?: () => Promise<boolean>;
}): Promise<AgentHomeDirectoryFile>;
