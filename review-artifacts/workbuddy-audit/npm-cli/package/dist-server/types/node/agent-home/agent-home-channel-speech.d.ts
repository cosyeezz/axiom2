/**
 * 频道发言落盘：jsonl append + directory lastPreview/unread。
 * POST /channels/:id/messages 和 SpeakInChannel 共用。写 directory 必须带锁。
 */
import { type ChannelAttachment } from './agent-home-attachments';
import { type AgentHomeChannel, type AgentHomeChannelMessage, type AgentHomeDirectoryFile } from './agent-home-directory';
export interface ApplyChannelSpeechInput {
    homeDir: string;
    channelId: string;
    text: string;
    from: 'user' | 'agent';
    agentId?: string;
    /** 锁内再 resolve 一次，避免解锁读到的 self 已过期。 */
    jobId?: string;
    /** 会话 id：与 isEnabled 同源，锁内认自己（#125667 F1）。 */
    sessionId?: string;
    mentionAgentIds?: readonly string[];
    messageId?: string;
    /**
     * 显式开一轮房间轮次（对齐上游的「用户发言开一轮」）。
     * 用户发言自动算；CreateChannel 的 kickoff 用这个标记显式开一轮。
     */
    startRoomTurn?: boolean;
    /**
     * 引用某条消息（对齐上游 SendMessage 的 reply_to）：
     * 房间历史里的短地址（#xxxxxxxx）或消息 id，前缀唯一即可。
     */
    replyTo?: string;
    /**
     * 附件（对齐上游 SendMessage 的 type:attachment）：本地文件路径。
     * 会复制进频道附件目录（内容寻址），房间据此长期可见。
     */
    attachments?: readonly string[];
    /**
     * 选项卡卡片（对齐上游 type:widget）。给了它就把这条消息发成卡片：
     * 正文用 prompt，且**本轮发言到此为止**——等用户点选（点选会作为
     * 用户发言开新一轮）。
     */
    widget?: unknown;
}
/** 附件收了之后的账：收进来的 + 没收成的（原因逐条转告模型）。 */
interface IngestedAttachments {
    attachments: ChannelAttachment[];
    issues: string[];
}
export type ApplyChannelSpeechResult = {
    ok: true;
    message: AgentHomeChannelMessage;
    channel: AgentHomeChannel;
    directory: AgentHomeDirectoryFile;
    /** 这次发言是否推进/开启了房间轮次（false = 没推进：插话/发卡片/不在编排里）。 */
    advancedTurn: boolean;
    /** 给了 replyTo 但地址解析不到（已按普通消息落盘，调用方可以提醒模型）。 */
    replyToDropped?: boolean;
    /** 附件没收进来的原因（超限/读不到/不是文件），逐条转告模型。 */
    attachmentIssues?: string[];
    /** 卡片不合法（没有正确落盘），原因原样转告模型。 */
    widgetIssue?: string;
} | {
    ok: false;
    error: 'CHANNEL_NOT_FOUND' | 'INVALID_SPEAKER' | 'DIRECTORY_UNAVAILABLE' | 'INVALID_WIDGET' | 'EMPTY_TEXT';
    /** INVALID_WIDGET 时给出人话原因，工具会原样转告模型。 */
    reason?: string;
};
export declare function applyChannelSpeech(input: ApplyChannelSpeechInput): Promise<ApplyChannelSpeechResult>;
/**
 * 调用方已持有 withAgentHomeDirectoryLock。
 * `preIngested`：锁外已经收好的附件（见 applyChannelSpeech）；不传则锁内现收
 * （已持锁的调用方——用户 HTTP 路径不带附件，走不到这条）。
 */
export declare function applyChannelSpeechToDirectory(directory: AgentHomeDirectoryFile, input: ApplyChannelSpeechInput, options?: {
    preIngested?: IngestedAttachments;
}): Promise<ApplyChannelSpeechResult>;
export {};
