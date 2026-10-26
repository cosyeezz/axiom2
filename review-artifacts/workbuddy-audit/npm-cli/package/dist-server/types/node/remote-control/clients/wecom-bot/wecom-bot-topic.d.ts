/**
 * WeCom AI Bot channel (频道) support.
 *
 * Over the long connection WeCom only pushes *notifications* for channel
 * activity (`topic_event` / `topic_reply_event` / `topic_at_bot`): they carry ids
 * but no content. The content itself is pulled over HTTPS with an access_token
 * that is derived from the same bot_id + Secret the long connection uses.
 *
 * This module is transport-only: event parsing, the HTTPS client and content
 * rendering. Wiring into the client / bridge lives elsewhere.
 *
 * Docs (灰度中): 频道接收与发送 → 接收事件 / 获取调用凭证 / 获取全部内容 / 回复被@的内容.
 */
import { type WecomBotEventCallback } from './wecom-bot-types';
export type WecomTopicEventKind = 'post' | 'reply' | 'at_bot';
/** Normalized channel event the bridge consumes. */
export interface WecomTopicEvent {
    kind: WecomTopicEventKind;
    msgid: string;
    topicId: string;
    postId: string;
    /** Present for reply events, and for @ inside a reply. */
    replyId?: string;
    /** Author / operator userid. Bot-originated events never reach this type. */
    userId: string;
    createTime: number;
}
/** Whether the frame is one of the channel content events we may consume. */
export declare function isWecomTopicContentEventType(eventtype: string | undefined): boolean;
export type ParsedTopicEvent = {
    ok: true;
    event: WecomTopicEvent;
} | {
    ok: false;
    reason: string;
};
/**
 * Normalize a channel event frame body.
 *
 * Only *new* posts / replies (`type === 1`) are consumed; updates and deletions
 * are ignored. Events from a bot (`from.aibotid`) are dropped: our own replies
 * come back as `topic_reply_event`, consuming them would make the agent answer
 * itself forever.
 */
export declare function parseWecomTopicEvent(body: WecomBotEventCallback['body']): ParsedTopicEvent;
/**
 * Same content can be announced by more than one event (a post that @s the bot
 * yields `topic_event` and `topic_at_bot`). Key identifies the content, not the event.
 */
export declare function wecomTopicContentKey(event: Pick<WecomTopicEvent, 'topicId' | 'postId' | 'replyId'>): string;
export interface WecomTopicUser {
    type?: number;
    userid?: string;
    aibotid?: string;
}
export interface WecomTopicChannel {
    topic_id?: string;
    topic_name?: string;
    topic_desc?: string;
    /** 0 公开 / 1 私有 */
    permission?: number;
    create_time?: number;
}
export interface WecomTopicItem {
    post_id?: string;
    reply_id?: string;
    parent_reply_id?: string;
    creator?: WecomTopicUser;
    create_time?: number;
    is_recalled?: boolean;
    content?: string;
    inline_file_list?: Array<{
        placeholder?: string;
        file_name?: string;
    }>;
    inline_mention_list?: Array<{
        placeholder?: string;
        member?: WecomTopicUser;
    }>;
    image_list?: unknown[];
}
export declare class WecomTopicApiError extends Error {
    readonly errcode: number;
    constructor(errcode: number, message: string);
}
/** 682004: the enterprise has not been enabled for the (灰度) channel capability. */
export declare const WECOM_TOPIC_ERRCODE_NOT_GRAY = 682004;
export interface WecomTopicApiDeps {
    fetch?: typeof fetch;
    now?: () => number;
    baseUrl?: string;
}
export declare class WecomTopicApi {
    private readonly credentials;
    private token?;
    private tokenInflight?;
    private readonly fetchFn;
    private readonly now;
    private readonly baseUrl;
    constructor(credentials: {
        botId: string;
        secret: string;
    }, deps?: WecomTopicApiDeps);
    /** Channels this bot has joined (paginated). */
    listChannels(opts?: {
        limit?: number;
        cursor?: string;
    }): Promise<{
        channels: WecomTopicChannel[];
        hasMore: boolean;
        nextCursor?: string;
    }>;
    /** All posts of a channel (paginated); without a cursor the newest/oldest end is returned. */
    listPosts(topicId: string, opts?: {
        limit?: number;
        cursor?: string;
        sort?: 'oldest' | 'newest';
        beginTime?: number;
        endTime?: number;
    }): Promise<{
        posts: WecomTopicItem[];
        hasMore: boolean;
        nextCursor?: string;
    }>;
    /** All replies under a post (paginated). */
    listReplies(topicId: string, postId: string, opts?: {
        limit?: number;
        cursor?: string;
        sort?: 'oldest' | 'newest';
    }): Promise<{
        replies: WecomTopicItem[];
        hasMore: boolean;
        nextCursor?: string;
    }>;
    getPost(topicId: string, postId: string): Promise<WecomTopicItem | undefined>;
    getReply(topicId: string, postId: string, replyId: string): Promise<WecomTopicItem | undefined>;
    /**
     * Reply under a post; `parentReplyId` threads under an existing reply. Long text is split.
     * `mentionUserId` @-mentions that member in the first chunk: channels have no
     * interactive card / popup, so an @ is the only way to signal the addressed person.
     */
    sendReply(topicId: string, postId: string, content: string, parentReplyId?: string, mentionUserId?: string): Promise<void>;
    private call;
    private getToken;
    private fetchToken;
    private post;
}
/** Split reply text into chunks the API accepts, preferring line breaks. */
export declare function splitWecomTopicReply(content: string): string[];
/** Turn placeholder markdown into plain readable text for the model. */
export declare function renderWecomTopicContent(item: WecomTopicItem | undefined): string;
export interface WecomTopicPromptInput {
    kind: WecomTopicEventKind;
    topicId: string;
    postId: string;
    replyId?: string;
    userId: string;
    /** Content of the new item (post body, or reply body). */
    content: string;
    /** For replies: the post they hang under, for context. */
    postContent?: string;
}
/** Prompt body of the <channel> event: what happened + how to respond. */
export declare function buildWecomTopicPrompt(input: WecomTopicPromptInput): string;
