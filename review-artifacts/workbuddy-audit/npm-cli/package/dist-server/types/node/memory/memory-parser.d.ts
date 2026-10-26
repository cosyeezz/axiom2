import { Memory, MemoryParseOptions, MemoryParser } from './memory-protocol';
/**
 * 解析 YAML frontmatter（独立函数，供 memory-scan 使用）
 *
 * @param content 文件内容
 * @returns frontmatter 对象，如果解析失败返回 undefined
 */
export declare function parseYamlFrontmatter(content: string): Record<string, unknown> | undefined;
export declare class MemoryParserImpl implements MemoryParser {
    parse(filePath: string, options: MemoryParseOptions): Promise<Memory>;
    /**
     * 解析 frontmatter 中的 globs
     */
    private parseGlobs;
}
