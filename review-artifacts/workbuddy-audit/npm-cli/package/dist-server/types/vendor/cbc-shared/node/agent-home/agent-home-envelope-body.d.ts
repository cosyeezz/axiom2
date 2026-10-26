/**
 * teammate-message 正文：不要把用户字直接嵌进 XML。
 * 新包一行 JSON；旧包仍当纯文本。闭标签用 lastIndexOf，避免正文里的
 * `</teammate-message>` 截断。
 */
/** 频道群对话信封。不是私信房 / MessageColleague。 */
export declare function isAgentHomeChannelEnvelope(text: string): boolean;
export declare function isAgentHomeColleagueEnvelope(text: string): boolean;
/** 看起来像 Agent Home 信封（频道或同事），解析失败时禁止当用户 1:1。 */
export declare function looksLikeAgentHomeEnvelope(text: string): boolean;
/**
 * UI 投影：主路径信封 + 旧叫醒正文 + SpeakInChannel 入站回执。
 * 模型收件箱只认 isAgentHomeChannelEnvelope，避免旧正文把 1:1 吃掉。
 */
export declare function isChannelEnvelopeText(text: string): boolean;
export declare function teammateMessageInner(text: string): string | undefined;
export declare function encodeEnvelopeTextPayload(payload: {
    text: string;
    roster?: string;
    mentions?: string;
    summary?: string;
    /** 轮转标记（如 "3/10"）：这封是轮到你发言，不是被 @。 */
    round?: string;
    /** 附件清单（`展示名 → 绝对路径`）：同事按路径 Read 就能看到内容。 */
    attachments?: string;
}): string;
export declare function decodeEnvelopeTextPayload(inner: string): {
    text: string;
    roster?: string;
    mentions?: string;
    summary?: string;
    round?: string;
    attachments?: string;
} | undefined;
/** XML 属性 + 正文。频道/同事/Teams 共用；要不要当 Agent Home 来信由调用方过滤。 */
export interface ParsedTeammateMessageXml {
    id: string;
    name?: string;
    messageId?: string;
    summary?: string;
    content: string;
}
export declare function parseTeammateMessageXml(text: string): ParsedTeammateMessageXml | undefined;
/**
 * 入站回执：头字段 + 正文 + 稳定分隔符 + 给人看的 how-to。
 * 机器只认分隔符，不要拿 how-to 文案当解析边界。
 * 回执必须是纯文本：`{ content }` JSON 会被 History 的 ToolResult 剥成用户原话。
 */
export declare const INCOMING_RECEIPT_SENTINEL = "-- agent-home --";
/**
 * 隐藏提示标记（对齐上游的 [SAND_HIDDEN_PROMPT]）：
 * 入站回执是喂给模型的"轮次提示"，不是房间里的发言。渲染历史/UI 时
 * 用 isAgentHomeHiddenPromptText 识别并跳过，别把它当成成员说过的话。
 */
export declare const AGENT_HOME_HIDDEN_PROMPT = "[agent-home hidden prompt]";
export declare function stripAgentHomeHiddenPrompt(text: string): string;
export declare function isAgentHomeHiddenPromptText(text: string): boolean;
export declare function formatIncomingReceipt(input: {
    preamble: readonly string[];
    headers: Record<string, string>;
    saidLabel: string;
    body: string;
    /** 结尾的轮次指令（对齐上游 "It's your turn, X. …"）。 */
    closing?: string;
    howTo: string;
}): string;
export declare function parseIncomingReceipt(text: string): {
    headers: Record<string, string>;
    body: string;
} | undefined;
//# sourceMappingURL=agent-home-envelope-body.d.ts.map