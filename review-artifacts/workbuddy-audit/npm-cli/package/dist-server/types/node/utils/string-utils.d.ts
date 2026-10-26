export declare abstract class StringUtils {
    static smartConvert(str: string): string | number | boolean | null | undefined;
    static extractJsonFromString(inputString: string): Record<string, string> | undefined;
    /**
     * Calculate Levenshtein distance between two strings
     */
    static levenshteinDistance(str1: string, str2: string): number;
    /**
     * Calculate similarity ratio between two strings (0-1, where 1 is identical)
     */
    static similarity(str1: string, str2: string): number;
    /**
     * Normalize Unicode quotes and Chinese punctuation to standard ASCII equivalents
     * Handles common cases where AI models might output ASCII punctuation but files contain Chinese punctuation
     */
    static normalizePunctuation(text: string): string;
    /**
     * 折叠所有连续空白（含换行）为单个空格并去掉首尾空白，把文本压成单行。
     *
     * 给「一条 = 一行」的列表型模板用（如 Skill 工具描述的 `<available_skills>`）。
     * 这类条目的描述来自 SKILL.md frontmatter，用 YAML 块标量书写时会带进换行：
     * 插件 skill 走完整 YAML parser，`>` 末尾留一个换行、`|` 保留全部内部换行；
     * 用户/产品 skill 走手写行解析器，`>` 已被空格拼成单行，但 `|` 仍按换行拼接。
     * 两条路径只要有换行进来，就会把同一行后续的字段（来源标签、`(location: ...)`）
     * 挤到下一行，破坏「一行一条」的格式契约。
     *
     * 只折叠空白，不动标点、不截断——避免损伤描述里的触发关键词。
     *
     * 注意 JS 的 `\s` 也覆盖非断行空格（`\u00a0`）和全角空格（`\u3000`）等，它们会被一并
     * 归一成 ASCII 空格。对「一行一条」的列表无影响，但需要保留原始排版的场景别用本函数。
     */
    static toSingleLine(text: string): string;
    /**
     * 检查一个字符是否是 UTF-16 代理对的高位部分
     */
    static isHighSurrogate(code: number): boolean;
    /**
     * 检查一个字符是否是 UTF-16 代理对的低位部分
     */
    static isLowSurrogate(code: number): boolean;
    /**
     * 检查给定位置的字符是否是代理对的一部分
     * 如果是，返回代理对的长度（2），否则返回1
     */
    static getCharLength(text: string, offset: number): number;
    /**
     * 向左移动一个完整的字符（跳过代理对）
     * @param text 文本
     * @param offset 当前位置
     * @returns 新的位置
     */
    static moveToPreviousChar(text: string, offset: number): number;
    /**
     * 向右移动一个完整的字符（跳过代理对）
     * @param text 文本
     * @param offset 当前位置
     * @returns 新的位置
     */
    static moveToNextChar(text: string, offset: number): number;
    /**
     * 获取文本的实际字符数（考虑代理对）
     * 例如 "abc🐦def" 返回 7 而不是 8
     */
    static getGraphemeLength(text: string): number;
    /**
     * 将 UTF-16 offset 转换为 grapheme offset
     * 例如 "abc🐦def"，UTF-16 offset=5 对应 grapheme offset=4
     */
    static utf16ToGraphemeOffset(text: string, utf16Offset: number): number;
    /**
     * 将 grapheme offset 转换为 UTF-16 offset
     */
    static graphemeToUtf16Offset(text: string, graphemeOffset: number): number;
    /**
     * Convert camelCase to Title Case with spaces
     * Examples:
     * - autoUpdates => Auto Updates
     * - trustedDirectories => Trusted Directories
     * - enabledPlugins => Enabled Plugins
     */
    static camelCaseToTitleCase(camelCase: string): string;
}
