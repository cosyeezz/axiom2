import { Logger } from '@celljs/core';
import { ReferenceService } from './reference-protocol';
/**
 * Service for processing file references in content
 * Handles @[path] imports and replaces them with file contents
 */
export declare class ReferenceServiceImpl implements ReferenceService {
    protected readonly logger: Logger;
    private fileReferencesPathOnly;
    setFileReferencesPathOnly(enabled: boolean): void;
    isFileReferencesPathOnly(): boolean;
    /**
     * Processes file references in content and replaces them with file contents
     * @param content The content containing file references
     * @param currentFilePath Optional current file path for resolving relative references
     * @returns Content with file references replaced
     */
    process(content: string, currentFilePath?: string): Promise<string>;
    /**
     * Gets directory file list as formatted content
     */
    private getDirectoryListing;
    /**
     * 对齐 Claude 的 file-read token cap：内联内容超过 MAX_IMPORT_FILE_TOKENS 时截断为前一段，
     * 并追加一句提示，引导模型用 Read offset/limit 分页或 Grep 检索文件其余部分。未超上限时原样返回。
     *
     * 截断算法与提示语对齐 Claude Code 的 Read 工具实现，分两种模式：
     * - 按行截断（正常多行文件）：估算可容纳的行数并逐步收缩，保留前 N 行。
     * - 按字符截断（超长单行文件）：无法按行分页时（如 minified JS / 压缩 JSON），退化为按字符截断。
     *
     * 说明：CodeBuddy 无精确 tokenizer，token 数为 estimateTokensRough 粗估，故提示中标注 `~`；
     * 且因内容是内联进 prompt（非 Read 工具返回），提示中补充文件绝对路径以便模型定位并分页读取。
     * 这里必须用 resolvedPath（绝对路径）而非原始 importPath：嵌套引用时 importPath 是相对父文件
     * 目录的路径，而模型执行 Read/Grep 的 cwd 是命令启动目录，用相对路径会定位到错误文件。
     */
    private truncateByTokenCap;
    /**
     * Recursively processes file imports with circular reference detection
     * Uses ImportUtils for import extraction and path resolution
     */
    private processImports;
}
