/**
 * Memory Prompt Builder — 与 Claude Code memdir.ts 的 buildMemoryLines/buildMemoryPrompt 对齐
 *
 * 构建结构化记忆系统的 prompt 指导文本。
 */
/**
 * 截断 MEMORY.md 内容到行数和字节数限制
 */
export declare function truncateEntrypointContent(raw: string): {
    content: string;
    lineCount: number;
    /** UTF-16 code units 长度，作为近似字节数使用 */
    charCount: number;
    wasLineTruncated: boolean;
    wasCharTruncated: boolean;
};
/**
 * 构建记忆系统行为指导文本（不含 MEMORY.md 内容）
 *
 * 与 Claude Code 的 buildMemoryLines() 对齐。
 *
 * @param displayName 显示名称（如 "auto memory"）
 * @param memoryDir 记忆目录路径
 * @param projectId 项目 ID
 * @param extraGuidelines 额外指导（可选）
 */
export declare function buildMemoryLines(displayName: string, memoryDir: string, projectId: string, extraGuidelines?: string[]): string[];
/**
 * 构建完整的记忆 prompt（含 MEMORY.md 内容）
 *
 * 与 Claude Code 的 buildMemoryPrompt() 对齐。
 */
export declare function buildMemoryPrompt(params: {
    displayName: string;
    memoryDir: string;
    projectId: string;
    extraGuidelines?: string[];
}): string;
