/**
 * Summary 内容提取与包装工具类
 *
 * 用于从 compact agent 生成的摘要中提取 <summary> 标签内容，
 * 并包装成完整的上下文恢复格式注入到后续对话。
 */
/**
 * 当 compact agent 的输出文本里不存在符合协议的摘要(<summary>…</summary> 或
 * <conversation_history_summary>…</conversation_history_summary>)、或抽出的正文为空时,
 * 由 SummaryUtils.requireCompactSummaryFromText 抛出。
 *
 * 调用方(ContextCompactSummarizer)用它短路 sendContinueMessage,这是阻断
 * "compact → 无摘要 → continue → 再触发阈值 → compact" 循环的唯一闸门。
 *
 * 注:之前曾把同名错误类放在 history-utils.ts(配套 requireCompactSummaryFromHistory),
 * 但扫 history 会读到 **上一次** 成功的摘要,无法识别"本次 compact 失败但历史里有旧摘要"
 * 的场景。现在改从本次 RunResult.finalOutput 直读,错误类下沉到 summary-utils 与文本工具同处。
 */
export declare class CompactSummaryNotFoundError extends Error {
    readonly isCompactNoSummary: true;
    constructor(message?: string);
}
export declare abstract class SummaryUtils {
    /**
     * 从文本中提取 <summary> 标签内容。
     * 兜底：如果没有 <summary> 标签，返回完整文本。
     */
    static extractSummaryContent(text: string): string;
    /**
     * 判断文本内容是否符合 compact 输出的结构（含 <summary> 或
     * <conversation_history_summary> 标签）。
     *
     * 与 HistoryUtils.hasCompactOutputStructure 同义,但因为
     * SummaryUtils 是更底层的纯文本工具,这里独立持有一份避免循环依赖。
     */
    static hasCompactOutputStructure(text: string): boolean;
    /**
     * 严格地从一段文本中提取 compact 摘要正文。
     *
     * 与 `extractSummaryContent` 的区别:
     * - `extractSummaryContent` 在没有 <summary> 标签时**兜底返回全文**(用于 view 层包装)
     * - 本方法要求文本必须**先通过 `hasCompactOutputStructure` 结构校验**
     *   再走 `extractSummaryContent` 抽取,且抽出的正文非空才返回 string;
     *   任一步不通过就返回 undefined。
     *
     * 用于 ContextCompactSummarizer 判断"本次 compact run 是否真的产出了合规摘要"。
     */
    static extractCompactSummaryFromText(text: string | undefined | null): string | undefined;
    /**
     * `extractCompactSummaryFromText` 的"必须有"版本:抽不到就抛
     * `CompactSummaryNotFoundError`,适合"没有摘要就不能继续"的关键路径。
     */
    static requireCompactSummaryFromText(text: string | undefined | null): string;
    /**
     * 将 summary 内容包装成完整的上下文恢复格式（后端注入用）。
     */
    static wrapSummaryWithContext(summaryContent: string, transcriptPath: string): string;
    /**
     * 从 assistant 消息的 content 数组中提取文本内容。
     * 支持两种格式：
     * - [{ type: 'output_text', text: '...' }] (OpenAI Agents SDK 格式)
     * - [{ type: 'text', text: '...' }] (实际 compact 输出格式)
     */
    static extractTextFromAssistantContent(content: unknown): string;
}
//# sourceMappingURL=summary-utils.d.ts.map