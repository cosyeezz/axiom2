/**
 * 频道收发的**线与上下文**（不推进轮次，也不是 MessageColleague）：
 *
 * - 出：`formatAgentHomeChannelEnvelope` —— 把一条频道发言包成 teammate-message 信封投给成员；
 * - 入：`parseAgentHomeChannelEnvelope` + `createChannelReceiptItems` —— 把信封换成
 *   「入站 SpeakInChannel 回执（action=incoming）」，形状不能做出站发送；
 * - 上下文：`formatRoomTurnHistory`（自他上次发言以来的房间历史）与
 *   `formatIncomingChannelReceiptOutput`（回执正文）；
 * - 判重：`historyAlreadyHasChannelEnvelope` / `inputHasIncomingChannelReceipt` ——
 *   同一封信不能叫醒两轮。
 *
 * 轮次状态机在 agent-home-channel-room-turn.ts；这里只认它的产物（round 标记 / 指针目标）。
 * 说话人在 teammate_id / from，可以是 user 或成员 agentId。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type AgentHomeChannelMessage, type AgentHomeDirectoryFile } from './agent-home-directory';
export interface AgentHomeChannelEnvelope {
    from: string;
    /** 用户本人说的话（对齐上游 priority：打断对方"非用户"的在途工作，先回它）。 */
    priority?: boolean;
    channelId: string;
    channelName: string;
    roster: string;
    mentions: string;
    mentionIds: string[];
    /** 轮转标记（如 "3/10"）：这封是轮到你发言，不是被 @。 */
    round: string;
    content: string;
    messageId: string;
    /** 附件清单（`展示名 → 绝对路径`）：收据要把它单列一行，同事据此 Read 到内容。 */
    attachments?: string;
}
/**
 * 附件清单（`展示名 → 绝对路径`）：同事按路径 Read 就能看到内容。
 * 房间历史与唤醒信共用同一份格式，别在两个地方各拼一遍。
 */
export declare function formatChannelAttachmentRefs(attachments: readonly {
    name: string;
    file: string;
}[] | undefined, attachmentsDir: string): string;
export declare function formatAgentHomeChannelEnvelope(input: {
    from?: string;
    channelId: string;
    channelName: string;
    roster: string;
    mentions?: string;
    mentionIds?: readonly string[];
    round?: string;
    content: string;
    messageId?: string;
    /** 用户发言：给对方一条"这是用户本人，先回"的中断语义。 */
    priority?: boolean;
    /**
     * 这条消息带的附件。必须配 `attachmentsDir` 给绝对路径：只写名字时同事读不到内容，
     * 实测会去磁盘上翻同名文件，结果拿一张更早的图回你（"回复的不是最新图"）。
     */
    attachments?: readonly {
        name: string;
        file: string;
    }[];
    attachmentsDir?: string;
}): string;
/**
 * 真实 @ 判定（收执的「被点名」收尾用）：mentions 属性只由真实 @ 名单填充，
 * 且自己要在叫醒目标里。mention_ids 单看不行——轮到我/催办/kickoff 都会带自己。
 */
export declare function envelopeMentionsSelf(parsed: Pick<AgentHomeChannelEnvelope, 'mentions' | 'mentionIds'>, selfId: string): boolean;
export declare function parseAgentHomeChannelEnvelope(text: string): AgentHomeChannelEnvelope | undefined;
/**
 * 收件箱入口：频道信封直接变成 SpeakInChannel 回执。
 * 看起来像 Agent Home XML 但解析失败 → 空数组，禁止当用户 1:1。
 * 普通文本（peek 回复）才走用户消息。
 */
export declare function createInboxTurnItems(text: string, sessionId: string): AgentInputItem[];
/**
 * 入站回执正文：必须是纯文本。
 * 带 `{ content }` 的 JSON 会被 History 的 ToolResult.is 剥成用户原话，
 * 模型就会以为自己已经 SpeakInChannel 过了。
 */
/**
 * 消息短地址（对齐上游 reply_to 的地址体系：t3u / t3s1）。
 * 我们用消息 id 的前 8 位：短、在房间里唯一、可直接写进 reply_to。
 */
export declare function formatMessageAddress(messageId: string): string;
export interface RoomHistoryOptions {
    /** 本成员自己的 id：自己的发言标 you，避免他重复自己说过的。 */
    selfId: string;
    /** 当前这条入站消息本身不再重复列一遍。 */
    excludeMessageId?: string;
    /**
     * 这封入站信对应的那条消息：无论它落在不在「自上次发言以来」的窗口里都要列出来。
     * 成员在这条消息入箱之后又发过言（忙完手头那一轮才轮到它被投递）时，它在窗口之外，
     * 不钉住的话回执只剩一行裸文本，丢掉短地址和引用（#150667）。
     */
    includeMessageId?: string;
    /** 单条消息截断长度（上游不截断，因为它要求"short and conversational"；
     *  我们的成员会发长报告，所以留一个宽松上限兜底）。 */
    messageMax?: number;
    /**
     * 频道附件目录（`<home>/agent-home/attachments/<channelId>`）。
     * 附件在行里渲染成 `名字 → 绝对路径`：同事能直接 Read 到内容（图片会以图像块返回），
     * 只给名字等于"知道有张图但看不到"（实测用户贴图后同事完全看不见）。
     * **必填**：漏传会静默退回"只写名字"、复现那个 bug，所以不给默认值。
     */
    attachmentsDir: string;
}
/**
 * 成员本轮该看到的内容 —— 对齐上游 `messagesSinceMemberLastSpoke`：
 * **自他上次发言以来的新消息**（最多 ROOM_PROMPT_HISTORY_LIMIT 条），
 * 而不是整段历史。上游的理由：只给增量，prompt 不随会话线性膨胀，
 * 也不诱导模型复述已经说过的内容。
 */
export declare function formatRoomTurnHistory(messages: readonly AgentHomeChannelMessage[], directory?: AgentHomeDirectoryFile | null, options?: RoomHistoryOptions): string;
export declare function formatIncomingChannelReceiptOutput(input: {
    from: string;
    channelId: string;
    channelName: string;
    text: string;
    selfId?: string;
    selfName?: string;
    defaultAgentId?: string;
    /** 房间历史（自他上次发言以来）；为空的兜底见 body 组装。 */
    recent?: string;
    /** 轮次标记（如 "1/3 · 2/10"）：非空表示轮到你发言。 */
    round?: string;
    /** 用户本人说的话：打断"非用户"的在途工作，先回它（对齐上游 priority）。 */
    priority?: boolean;
    /** 同房间的其他参与者显示名：拼 [Group chat: "…" - with A, B]。 */
    peers?: readonly string[];
    messageId?: string;
    /**
     * 这条消息带的附件（`展示名 → 绝对路径`，来自信封）。
     * 单独出一行而不是只靠房间历史：历史行可能由旧版本进程渲染（只写名字），
     * 而这条发言恰恰是同事最需要看的那一张。
     */
    attachments?: string;
    /** 这条消息 @ 点名的正是收信人本人：收尾必须回频道（沉默不算回应）。 */
    mentionedYou?: boolean;
}): string;
export declare function createChannelReceiptItems(text: string, sessionId: string): AgentInputItem[];
export declare function parseIncomingChannelToolArgs(raw: unknown): {
    from: string;
    channelId: string;
    channelName: string;
    content: string;
    messageId: string;
} | undefined;
export declare function historyAlreadyHasChannelEnvelope(session: Session | undefined, text: string): boolean;
/**
 * 只看这一轮末尾。History 拦截器会把整段会话塞进 request.input，
 * 不能因为历史上有过频道回执，就把后面的 1:1 当成频道叫醒。
 */
export declare function inputHasIncomingChannelReceipt(input: readonly AgentInputItem[]): boolean;
