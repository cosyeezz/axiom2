export declare abstract class MarkdownUtils {
    /**
     * 提取 Markdown 文件中的 YAML front matter 元信息和内容
     *
     * **完整 YAML 规范版本**，使用 `yaml` 库（对齐 Claude Code
     * `src/utils/frontmatterParser.ts`）。支持嵌套 mapping / 复杂数组对象 /
     * 等所有 YAML 1.2 语义，是为 agent/skill frontmatter.hooks 这类结构化字段
     * 增加的新入口。
     *
     * 与现有 `extractFrontMatterWithContent`（手写简版 parser，返回字符串/数组
     * 的扁平结构）并存；迁移调用点前保留两种能力防止 regression。
     *
     * @returns `{ data, content, parseError? }`。YAML 解析失败时 `data` 为空
     *          对象且 `parseError` 携带失败信息；调用方可据此向用户/日志输出
     *          可定位的诊断。正常路径 `parseError` 为 undefined。
     */
    static extractFrontMatterFull(markdownContent: string): Promise<{
        data: Record<string, any>;
        content: string;
        parseError?: string;
    }>;
    /**
     * 提取 Markdown 文件中的 YAML front matter 元信息和内容
     */
    static extractFrontMatterWithContent(markdownContent: string): {
        data: Record<string, any>;
        content: string;
    };
    /**
     * 解析正整数 frontmatter 字段（如 maxTurns）。
     * 接受正整数 number 或纯十进制数字串；其余返回 undefined（调用方告警并忽略）。
     * 字符串路径只认 /^\d+$/：未加引号的 YAML 里 `0x10` / `1e2` 会作为字符串传入，
     * 直接 Number() 会静默解析成 16 / 100，与「纯数字串」语义不符，须拒掉。
     */
    static parsePositiveIntField(value: unknown): number | undefined;
    /**
     * 解析布尔 frontmatter 字段（如 background）。
     * 对齐 Claude Code：接受 true/false 布尔或 'true'/'false' 字符串；
     * 其余返回 undefined（调用方告警并忽略）。
     */
    static parseBooleanField(value: unknown): boolean | undefined;
    /**
     * 解析列表字段，支持数组或逗号分隔的字符串
     */
    static parseListField(value?: string | string[]): string[];
    /**
     * 按逗号分割字符串，但保留大括号内的逗号
     */
    private static splitByCommaRespectingBraces;
}
