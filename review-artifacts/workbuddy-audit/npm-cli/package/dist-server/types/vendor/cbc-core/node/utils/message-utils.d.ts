import type { AgentInputItem, UserMessageItem } from '../../../cbc-shared/node/index.js';
/**
 * 消息处理工具类
 *
 * 提供通用的消息操作功能，避免代码重复
 */
export declare abstract class MessageUtils {
    /**
     * 合并连续的用户消息
     *
     * @param messages 消息列表
     * @returns 合并后的消息列表
     */
    static mergeConsecutiveUserMessages(messages: AgentInputItem[]): AgentInputItem[];
    private static shouldKeepUserMessageSeparate;
    /**
     * 合并用户消息组
     *
     * @param messages 用户消息列表
     * @returns 合并后的单个用户消息
     */
    private static mergeUserMessageGroup;
    /**
     * 添加系统提醒到消息
     *
     * @param input 消息列表
     * @param content 要添加的系统提醒内容（按约定为完整 `<system-reminder …>…</system-reminder>` 包裹块）
     * @param position 添加位置：'first' 或 'last'
     */
    static addSystemReminder(input: AgentInputItem[], content: string, position?: 'first' | 'last'): void;
    /**
     * 中和注入块正文里的字面量 `</system-reminder>`（issue #100020）。
     * 只中和包裹标签**内部**的正文，包裹本身保留。
     */
    private static neutralizeReminderBlockContent;
    /**
     * 查找第一个用户消息
     */
    private static findFirstUserMessage;
    /**
     * 查找最后一个用户消息
     */
    private static findLastUserMessage;
    /**
     * 检查第一条用户消息是否包含指定 data-role 的 system-reminder
     */
    static firstUserMessageContainsRole(input: AgentInputItem[], role: string): boolean;
    /**
     * 确保消息内容是数组格式
     */
    static ensureContentIsArray(message: UserMessageItem): void;
    /**
     * 从消息列表中提取所有 system-reminder 内容
     * 用于在压缩前保存规则，压缩后重新注入
     *
     * @param messages 消息列表
     * @returns 提取的 system-reminder 内容数组
     */
    static extractSystemReminders(messages: AgentInputItem[]): string[];
    /**
     * 从消息列表中过滤掉所有 system-reminder 内容
     * 用于压缩时避免将规则内容压缩进摘要
     *
     * @param messages 消息列表（会被原地修改）
     * @returns 修改后的消息列表
     */
    static filterSystemReminders(messages: AgentInputItem[]): AgentInputItem[];
    /**
     * 移除消息列表中的 <user_query> 标签但保留内部内容
     * 用于压缩场景，避免标签泄漏到摘要中
     */
    static stripUserQueryTagsFromMessages(messages: AgentInputItem[]): AgentInputItem[];
    /**
     * 创建带有 system-reminder 的消息副本（用于压缩场景）
     * 深拷贝消息并移除 system-reminder 内容
     *
     * @param messages 原始消息列表
     * @returns 过滤后的消息副本
     */
    static createFilteredCopyForCompaction(messages: AgentInputItem[]): AgentInputItem[];
    private static filterHiddenSystemRemindersForCompaction;
    static stripSystemRemindersOutsideUserQuery(text: string): string;
    /**
     * 压缩链路的统计日志出口。
     *
     * **禁止改回 `process.stderr.write` / `process.stdout.write`**（issue #76749）：
     * TUI 下裸写 stderr 会破坏 Ink 帧间光标定位，导致行级 diff 错位、spinner 残留。
     * 走 logger 落盘即可，既保留排查信息又不碰 TTY。
     *
     * `catch` 有意整段吞掉，不做分级上报：日志出口的任何失败（容器未就绪、logger 自身
     * 抛错）都不得影响压缩本身；而「失败时改走 stderr 兜底」恰会在异常路径上重新引入
     * 本 issue 要修掉的 TTY 裸写。统计丢失是可接受的降级。
     */
    private static logCompaction;
    /**
     * Microcompact: clear output of old tool results (> 1 hour) to reduce token count.
     * Modifies items in place. Should be called BEFORE createFilteredCopyForCompaction.
     */
    /**
     * Clear old tool result contents to reduce token count before compaction.
     *
     * @param messages - The history items to process (mutated in place)
     * @param options.keepRecent - When set, ignore time-based cutoff and keep only
     *   the N most recent compactable tool results; clear all older ones.
     *   Kept results are also truncated to maxCharsPerResult to prevent
     *   a few large tool outputs from exceeding the model's context limit.
     * @param options.maxCharsPerResult - Max characters to keep per retained tool result
     *   (default 1500 ≈ ~375 tokens). Content beyond this is replaced with a truncation notice.
     */
    static performMicrocompact(messages: AgentInputItem[], options?: {
        keepRecent?: number;
        maxCharsPerResult?: number;
    }): void;
    /**
     * Truncate a single tool result's content to maxChars. Returns 1 if truncated, 0 if not.
     */
    private static truncateToolResultContent;
    /**
     * Strip image content from messages before compaction.
     * Replaces image blocks with [image] placeholder. Modifies in place.
     */
    static stripImagesForCompaction(messages: AgentInputItem[]): void;
    /**
     * 判断文本是否包含系统注入的标签内容（system-reminder、command-message、command-name、local-command-stdout）
     *
     * @param text 要检查的文本
     * @returns 是否包含系统注入标签
     */
    static isSystemInjectedContent(text: string): boolean;
    /**
     * 判断文本是否包含 user_query 标签
     *
     * @param text 要检查的文本
     * @returns 是否包含 user_query 标签
     */
    static isUserQueryContent(text: string): boolean;
    /**
     * 用 user_query 标签包裹文本
     *
     * @param text 要包裹的文本
     * @returns 包裹后的文本，如果已包裹则返回原文本
     */
    static wrapUserQuery(text: string): string;
    /**
     * 移除文本中的 user_query 标签,保留标签内的内容。
     *
     * 与 `isUserQueryContent`(只对完全等于 `<user_query>...</user_query>` 的字符串返回 true)
     * 不同 —— 本方法允许标签前后存在空白 / 换行 / 其他被剥过的标签残留(典型场景:
     * 文本先被 `stripSystemReminders` 剥过 system-reminder,只剩 `\n<user_query>...\n</user_query>` 的形态)。
     *
     * 实现:正则 + `[\s\S]*?` 跨行匹配,匹配到就用内部内容替换,并 trim 掉首尾空白。
     *
     * @param text 要处理的文本
     * @returns 移除标签后的文本(及前后空白 trim)
     */
    static stripUserQueryTags(text: string): string;
    /**
     * 移除文本中的 system-reminder 标签及其内容
     */
    static stripSystemReminders(text: string): string;
}
//# sourceMappingURL=message-utils.d.ts.map