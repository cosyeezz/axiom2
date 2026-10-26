import { CommandXmlTags, type UserMessageItem } from '../../../cbc-shared/node/index.js';
export declare enum CommandType {
    BASH = "BASH",
    MEMORY = "MEMORY",
    COMMAND = "COMMAND"
}
export interface ParseCommandMessage {
    text: string;
    type: CommandType;
}
export declare abstract class CommandMessageUtils {
    static LOCAL_COMMAND_TIP: string;
    private static readonly regexCache;
    static buildTag(content: string | undefined, tag: CommandXmlTags): string;
    private static getRegex;
    static getXmlContent(text: string, tag: CommandXmlTags, flags?: string): string | undefined;
    static buildCaveat(): UserMessageItem;
    static buildInput(ctx: {
        name: string;
        args: unknown[];
        timestamp?: number;
    }, executor: {
        name: string;
        message?: string;
    }): UserMessageItem;
    static buildOutput(stdout: string): UserMessageItem;
    static buildBashInput(command: string): UserMessageItem;
    static buildBashOutput(stdout?: string, stderr?: string): UserMessageItem;
    static buildEmpty(): UserMessageItem;
    static buildMemory({ fact, scope }: {
        fact: string;
        scope: string;
    }): UserMessageItem;
    static buildPlanOutput(filePath: string, content: string): UserMessageItem;
    /**
     * 判断给定的文本是否应该被过滤掉，不显示给用户
     * 过滤条件：
     * - /clear 命令消息
     * - 以 <system-reminder> 开头的系统注入内容（且不含真实用户输入）
     */
    static isSystemInternalMessage(text: string): boolean;
    /**
     * Parse agent-notification XML content
     */
    static parseAgentNotification(text: string): {
        summary: string;
        status: string;
    } | null;
    /**
     * Check if text contains agent-notification XML
     */
    static isAgentNotification(text: string): boolean;
    /**
     * 解析XML格式的命令输入
     */
    static parseInput(xmlText: string): ParseCommandMessage | undefined;
    /**
     * 解析XML格式的命令输出
     */
    static parseOutput(xmlText: string): ParseCommandMessage | undefined;
    /**
     * 是否为本地命令在会话历史里留下的记账项：caveat、命令回显（`<command-name>`）、
     * 命令输出（`<local-command-stdout>`）、本地 bash 的输入输出、plan 输出。
     *
     * 这些 item 的 role 是 user、也不带 skipRun，因此按「真实用户消息」判定会命中；
     * 但它们只是本地命令的痕迹，**不代表用户开启了新一轮对话**。调用方（如 TUI 的
     * loading 计时器）需要区分「新一轮」和「本地命令留痕」时用这个判据。
     *
     * 识别口径复用 parseInput / parseOutput / parsePlanOutput，避免调用方各自
     * 维护一份 XML 标签清单而漂移。
     */
    static isLocalCommandRecord(text: string): boolean;
    /**
     * {@link isLocalCommandRecord} 的 item 版本。
     *
     * 必须读 **原始** content：`MessageContentUtils.extractTextContent` 已经把命令 XML
     * 拆开（`<command-name>/doctor</command-name>` → `/doctor`），拿它的结果再判就永远
     * 判不出来。
     */
    static isLocalCommandRecordItem(item: UserMessageItem): boolean;
    /**
     * 解析计划输出
     */
    static parsePlanOutput(xmlText: string): {
        filePath: string;
        content: string;
    } | undefined;
}
//# sourceMappingURL=command-message-utils.d.ts.map