/**
 * WeChat Work AI Bot WebSocket API Types
 *
 * Type definitions for the enterprise WeChat AI Bot WebSocket long connection API.
 * Reference: https://developer.work.weixin.qq.com/document/path/101463
 */
/** Generic WebSocket frame structure */
export interface WecomBotWsFrame {
    cmd: string;
    headers: {
        req_id: string;
        [key: string]: string;
    };
    body: unknown;
}
/** Subscribe request (cmd: 'aibot_subscribe') */
export interface WecomBotSubscribeFrame extends WecomBotWsFrame {
    cmd: 'aibot_subscribe';
    body: {
        bot_id: string;
        secret: string;
    };
}
/** Message callback (cmd: 'aibot_msg_callback') */
export interface WecomBotMsgCallback extends WecomBotWsFrame {
    cmd: 'aibot_msg_callback';
    body: {
        msgid: string;
        aibotid: string;
        chatid: string;
        chattype: 'group' | 'single';
        from: {
            userid: string;
        };
        msgtype: 'text' | 'image' | 'mixed' | 'voice' | 'file';
        text?: {
            content: string;
        };
        image?: {
            url: string;
            aeskey: string;
        };
        /**
         * mixed 消息结构（实测，2026-04-28 诊断日志确认）：
         * {
         *   msg_item: [
         *     { msgtype: 'image', image: { url, aeskey } },
         *     { msgtype: 'text', text: { content: '...' } },
         *     // 还可能是 voice/file
         *   ]
         * }
         * 注意：此前错写为 `items: [{type, content}]`，实际字段名是 `msg_item`，
         *   子项字段是 `msgtype`，内容嵌套在 `sub[msgtype]` 下（和顶层 body 同结构）。
         */
        mixed?: {
            msg_item: Array<{
                msgtype: 'text';
                text: {
                    content: string;
                };
            } | {
                msgtype: 'image';
                image: {
                    url: string;
                    aeskey: string;
                };
            } | {
                msgtype: 'voice';
                voice: {
                    url: string;
                    aeskey: string;
                };
            } | {
                msgtype: 'file';
                file: {
                    url: string;
                    aeskey: string;
                    filename: string;
                };
            }>;
        };
        voice?: {
            url: string;
            aeskey: string;
        };
        file?: {
            url: string;
            aeskey: string;
            filename: string;
        };
        /**
         * 来源附加信息：有值表示本次回调不是普通用户消息。
         * `channel` = 来自频道（同一内容还会以频道事件再投递一次）。
         */
        compat_info?: {
            source?: string;
        };
    };
}
/** Event callback (cmd: 'aibot_event_callback') */
export interface WecomBotEventCallback extends WecomBotWsFrame {
    cmd: 'aibot_event_callback';
    body: {
        msgid: string;
        create_time: number;
        aibotid: string;
        /** 频道事件中 userid 与 aibotid 互斥：机器人自己的操作带 aibotid。 */
        from: {
            userid?: string;
            aibotid?: string;
        };
        chatid?: string;
        chattype?: 'group' | 'single';
        /** 频道事件（topic_*）外层的频道 ID；单聊/群聊事件不带。 */
        topic_id?: string;
        msgtype: 'event';
        event: {
            eventtype: 'enter_chat' | 'template_card_event' | 'feedback_event' | 'disconnected_event' | 'topic_at_bot' | 'topic_event' | 'topic_reply_event' | 'topic_bot_join_leave' | 'topic_member_change' | 'topic_info_change';
            event_key?: string;
            task_id?: string;
            template_card_event?: {
                card_type?: string;
                event_key?: string;
                task_id?: string;
            };
            [key: string]: unknown;
        };
    };
}
/** Stream reply frame (cmd: 'aibot_respond_msg') */
export interface WecomBotRespondMsgFrame extends WecomBotWsFrame {
    cmd: 'aibot_respond_msg';
    body: {
        msgtype: 'stream';
        stream: {
            id: string;
            finish: boolean;
            content: string;
        };
    };
}
/** Welcome message frame (cmd: 'aibot_respond_welcome_msg') */
export interface WecomBotWelcomeMsgFrame extends WecomBotWsFrame {
    cmd: 'aibot_respond_welcome_msg';
    body: {
        msgtype: 'text';
        text: {
            content: string;
        };
    };
}
/** Proactive push frame (cmd: 'aibot_send_msg') */
export interface WecomBotSendMsgFrame extends WecomBotWsFrame {
    cmd: 'aibot_send_msg';
    body: {
        chatid: string;
        chat_type: number;
        msgtype: 'markdown' | 'template_card';
        markdown?: {
            content: string;
        };
        template_card?: Record<string, unknown>;
    };
}
/** Update a template card after a click (cmd: 'aibot_respond_update_msg') */
export interface WecomBotUpdateMsgFrame extends WecomBotWsFrame {
    cmd: 'aibot_respond_update_msg';
    body: {
        response_type: 'update_template_card';
        /** 94888 更新按钮为不可点击状态 */
        button?: {
            replace_name: string;
        };
        template_card: Record<string, unknown>;
    };
}
/** Heartbeat frame (cmd: 'ping') */
export interface WecomBotPingFrame extends WecomBotWsFrame {
    cmd: 'ping';
    body: Record<string, never>;
}
/** Generic WebSocket response (for subscribe/ping/send acks) */
export interface WecomBotWsResponse {
    headers: {
        req_id: string;
    };
    errcode: number;
    errmsg: string;
}
export declare const WECOM_BOT_WS_URL = "wss://openws.work.weixin.qq.com";
export declare const DEFAULT_HEARTBEAT_INTERVAL_MS = 30000;
export declare const DEFAULT_MAX_RECONNECT_DELAY_MS = 60000;
/** How often a kicked client checks whether the local process that took its bot is gone. */
export declare const WECOM_TAKEOVER_POLL_MS = 15000;
export declare const DEFAULT_DEDUP_WINDOW_SIZE = 1000;
export declare const STREAM_TIMEOUT_MS: number;
/** Official thinking animation: empty `<think>` tags render as three bouncing dots. */
export declare const WECOM_STREAM_THINK = "<think></think>";
/** Same req_id must wait for errcode; 400ms keeps the bubble from sticking on the first frame. */
export declare const STREAM_REPLY_ACK_TIMEOUT_MS = 400;
/**
 * Alternating leading marks on intermediate frames. WeCom strips ZW / trailing
 * cursors then treats a later frame as "old + suffix" and inserts a newline.
 * Changing the first character makes consecutive full-text frames fail that check.
 * Block cursors (▌/▍) survived the strip but stayed visible after finish; use
 * two blank-looking spaces that CJK fonts have and WeCom does not treat as ZW.
 */
export declare const WECOM_STREAM_MARK_A = "\u3000";
export declare const WECOM_STREAM_MARK_B = "\u00A0";
export declare const WECOM_STREAM_MARK_RE: RegExp;
/** Intermediate stream frames are coalesced; finish still flushes immediately. */
export declare const WECOM_STREAM_PUSH_INTERVAL_MS = 80;
/**
 * Wait after response_done so late tokens of the same response still join this
 * bubble. A later model response is hundreds of ms away; trailing deltas are not.
 */
export declare const WECOM_SEGMENT_GRACE_MS = 160;
export declare const ENV_KEY_WECOM_BOT_ID = "CODEBUDDY_WECOM_BOT_ID";
export declare const ENV_KEY_WECOM_BOT_SECRET = "CODEBUDDY_WECOM_BOT_SECRET";
export declare const ENV_KEY_WECOM_BOT_WS_URL = "CODEBUDDY_WECOM_BOT_WS_URL";
/** 全局默认流式开关（未设置时按内置默认 true）。取值 1/0/true/false。 */
export declare const ENV_KEY_WECOM_STREAMING_DEFAULT = "CODEBUDDY_WECOM_STREAMING_DEFAULT";
/** 全局默认权限/建议卡片开关（未设置时按内置默认 true）。取值 1/0/true/false。 */
export declare const ENV_KEY_WECOM_CARDS_DEFAULT = "CODEBUDDY_WECOM_CARDS_DEFAULT";
/** 频道 HTTPS 接口根（获取调用凭证 / 拉取帖子与评论 / 回复评论）。 */
export declare const WECOM_BOT_API_BASE = "https://qyapi.weixin.qq.com/cgi-bin/aibot";
