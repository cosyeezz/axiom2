/**
 * 格式化输入文本选项
 */
export interface FormatInputOptions {
    /** 是否保留 ESC 字符（用于代码片段） */
    preserveEsc?: boolean;
    /** 是否保留 Tab 字符（用于代码缩进） */
    preserveTabs?: boolean;
}
/**
 * 解析模式
 */
export declare enum ParseMode {
    NORMAL = "NORMAL",
    IN_PASTE = "IN_PASTE"
}
/**
 * 粘贴模式标记
 */
export declare const PASTE_START = "\u001B[200~";
export declare const PASTE_END = "\u001B[201~";
/**
 * 解析器状态
 */
export interface ParserState {
    mode: ParseMode;
    incomplete: string;
}
/**
 * 解析后的输入项
 */
export interface ParsedInput {
    sequence: string;
    isPasted: boolean;
}
/**
 * 输入解析器抽象类
 * 提供完整的 ANSI 转义序列解析和粘贴模式处理
 */
export declare abstract class InputParser {
    /**
     * 完整序列正则：匹配所有可能的 ANSI 转义序列
     * 包括：OSC, DCS, CSI, SS3, ESC+字符
     */
    private static readonly COMPLETE_SEQUENCE_REGEX;
    /**
     * 不完整序列正则：匹配可能不完整的序列
     */
    private static readonly INCOMPLETE_SEQUENCE_REGEX;
    /**
     * 创建初始解析器状态
     */
    static createState(): ParserState;
    /**
     * 创建粘贴输入项
     */
    private static createPastedInput;
    /**
     * 创建普通输入项
     */
    private static createNormalInput;
    /**
     * 规范化输入为字符串
     */
    private static normalizeInput;
    /**
     * 处理普通模式下的输入
     */
    private static handleNormalMode;
    /**
     * 处理粘贴模式下的输入
     */
    private static handlePasteMode;
    /**
     * 解析输入数据，返回解析后的输入项数组和更新后的状态
     *
     * @param state 当前解析器状态
     * @param data 输入数据（可以是 string 或 Buffer）
     * @param isEnd 是否为最后一块数据（flush 时为 true）
     * @returns [解析后的输入项数组, 更新后的状态]
     */
    static parse(state: ParserState, data?: string | Buffer | undefined, isEnd?: boolean): [ParsedInput[], ParserState];
    /**
     * 计算粘贴文本的行数，统一规范：
     * - 将 CRLF/CR 归一为 \n
     * - 去除末尾多余的连续换行
     * - 至少返回 1 行
     */
    static computePastedLineCount(text: string): number;
    /**
     * 生成压缩占位符（纯可见文本，跨终端稳定）
     * 格式: [Pasted text #<id>: <N> lines]
     */
    static createCompressedPlaceholder(pasteId: number, lineCount: number): string;
    /**
     * 构造占位符正则
     * - exact=true: 精确匹配指定行数
     * - exact=false: 宽松匹配任意行数
     */
    static buildCompressedPlaceholderRegex(pasteId: number, lineCount?: number, exact?: boolean): RegExp;
    /**
     * Windows 上，当整段输入是裸绝对路径时补充引号，缺少结束引号时补齐。
     */
    private static quoteWindowsPathInput;
    /**
     * 格式化输入文本
     * 注意：某些场景下（如粘贴代码）可能需要保留特殊字符
     */
    static formatInput(input: string, options?: FormatInputOptions): string;
}
