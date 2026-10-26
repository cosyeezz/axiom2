import { type JSONPath } from 'jsonc-parser';
/**
 * JSON/JSONC 工具类
 *
 * 提供 JSONC (JSON with Comments) 格式的解析和序列化功能。
 * JSONC 是 JSON 的超集，支持：
 * - 单行注释 (//)
 * - 多行注释 (/* *\/)
 * - 尾随逗号 (trailing commas)
 */
export declare abstract class JsonUtils {
    /**
     * 解析 JSONC 字符串
     *
     * 支持：
     * - 单行注释 (//)
     * - 多行注释 (/* *\/)
     * - 尾随逗号
     * - 标准 JSON 格式完全兼容
     *
     * @param content - 要解析的 JSONC 字符串
     * @returns 解析后的对象
     * @throws Error 如果解析失败
     */
    static parse<T = unknown>(content: string): T;
    /**
     * 将对象序列化为 JSON 字符串
     *
     * @param value - 要序列化的值
     * @param space - 缩进空格数（默认 2）
     * @returns 格式化的 JSON 字符串
     */
    static stringify(value: unknown, space?: number): string;
    private static readonly FORMATTING_OPTIONS;
    static modifyProperty(text: string, path: JSONPath, value: unknown): string;
    static updateText(text: string, newObj: Record<string, unknown>): string;
    /**
     * 修复 JSON 字符串中的中文引号，替换为英文引号
     * 处理的中文引号类型：
     * - " " (U+201C U+201D - left/right double quotation mark)
     * - ' ' (U+2018 U+2019 - left/right single quotation mark)
     * - 「」(U+300C U+300D - left/right corner bracket)
     * - 『』(U+300E U+300F - left/right white corner bracket)
     *
     * 注意：这个函数是最大努力修复，可能不完美。对于复杂情况，
     * 仍可能需要模型重新生成。
     *
     * @param text - 包含中文引号的 JSON 字符串
     * @returns 替换后的 JSON 字符串
     */
    static normalizeJsonQuotes(text: string): string;
}
