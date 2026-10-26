import { type AgentInputItem, type UserMessageItem } from '../../../cbc-shared/node/index.js';
export declare abstract class MessageContentUtils {
    /** 用户消息是否携带图片/文件附件块（无文本的纯附件提问也算用户输入）。 */
    static hasAttachmentContent(item: UserMessageItem): boolean;
    /**
     * 检查用户消息是否有可见的内容
     */
    static hasVisibleContent(item: UserMessageItem): boolean;
    /**
     * 从用户消息中提取文本内容
     * @param item 用户消息项
     * @param preserveNewlines 是否保留换行符，默认 false（移除换行符）
     */
    static extractTextContent(item: UserMessageItem, preserveNewlines?: boolean): string;
    /**
     * 从历史消息中反向查找最近一条真实用户输入文本。
     * 跳过 providerData.skipRun 标记的系统自动消息。
     */
    static getLatestRealUserMessage(messages: readonly AgentInputItem[] | undefined): string | undefined;
    /** 移除文本中的 system-reminder 标签及其内容 */
    private static stripSystemReminder;
    /** 检测 input_text 块是否为 image_local_path 标记 */
    static isImageLocalPathBlock(text: string | undefined): boolean;
    /**
     * 将 <teammate-message> 标签替换为友好的摘要文本
     * 优先使用 summary 属性，否则提取标签内容
     */
    private static stripTeammateMessage;
    /**
     * 从历史消息中获取 AI 生成的摘要
     * 从最新的 SummaryItem 中获取
     */
    static getAISummary(messages: AgentInputItem[]): string | undefined;
    /**
     * 从历史消息中提取会话摘要
     * 优先级：AI 生成的摘要 > 最近的用户消息
     */
    static getSessionSummary(messages: AgentInputItem[]): string;
    /**
     * 从历史消息中获取会话名称
     * 委托给 getEffectiveSessionTitle，按优先级返回 custom-title > ai-title > topic > first-message
     */
    static getSessionName(messages: AgentInputItem[]): string | undefined;
}
//# sourceMappingURL=message-content-utils.d.ts.map