/**
 * `@文件引用` 语法：`@` 必须位于行首或空白字符之后，其后紧跟非空白且非 `@` 的字符。
 *
 * 两条约束各自对应一类误判：
 * - `(?<!\S)` 对齐 TUI 的文件补全判定（`InputStateUtils.hasFileContext`），词内的 `@`
 *   （如 `foo@bar.com`）不算引用；
 * - `[^\s@\n]+` 排除连续 `@`，避免 git diff 的 `@@ -72,5 +72,6 @@` 被当成文件引用。
 *   旧规则 `/@([^\s\n]+)/` 会从 `@@` 中捕获到裸 `@`，经路径归一化后解析成工作目录，
 *   再把整个目录列表当成 Bash 结果注入首包提示词。
 */
export declare const IMPORT_PATTERN: RegExp;
export declare const MAX_IMPORT_DEPTH = 5;
/**
 * 单个 @ 引用文件的最大内联字节数（256KB，对齐 Claude Code 的 at-mention 上限）。
 * 超过该大小的文件不做全文内联，保留原始 @path 文本，交由模型按需用 Read/Grep 等工具读取，
 * 避免超大文件把整条 prompt 撑爆导致模型请求 400 input length too long。
 */
export declare const MAX_IMPORT_FILE_SIZE = 262144;
/**
 * 单个 @ 引用文件内联内容的最大 token 数（对齐 Claude Code 的 file-read token cap 默认值 25000）。
 * 文件虽在 256KB 字节上限内，但内容 token 仍可能偏大；超过该上限时按行截断为前一段，
 * 并追加一句提示，引导模型用 Read offset/limit 分页或 Grep 检索文件其余部分。
 */
export declare const MAX_IMPORT_FILE_TOKENS = 25000;
/**
 * @ 引用目录时列出的最大条目数（对齐 Claude Code 的目录 at-mention 上限 1000）。
 * 超过时截断并追加 "… and N more entries"，避免超大目录列表撑爆上下文。
 */
export declare const MAX_IMPORT_DIR_ENTRIES = 1000;
export interface ImportMatch {
    /** 完整匹配字符串，如 "@docs/style.md" */
    fullMatch: string;
    /** 导入路径，如 "docs/style.md" */
    importPath: string;
    /** 匹配在内容中的位置索引 */
    index: number;
    /** 解析后的绝对路径 */
    resolvedPath: string;
}
export declare abstract class ImportUtils {
    /**
     * 提取内容中的 @path 导入引用
     */
    static extractImports(content: string, currentFilePath: string): ImportMatch[];
    /**
     * 解析导入路径为绝对路径
     */
    static resolveImportPath(importPath: string, currentFilePath?: string): string;
    /**
     * 检查位置是否在代码块内
     */
    static isInCodeBlock(content: string, position: number): boolean;
}
