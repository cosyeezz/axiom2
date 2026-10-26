import { type MemorySemanticType } from './memory-types';
/**
 * 记忆文件头信息
 */
export interface MemoryHeader {
    /** 相对于 memoryDir 的文件名 */
    filename: string;
    /** 绝对文件路径 */
    filePath: string;
    /** 文件修改时间戳 (ms) */
    mtimeMs: number;
    /** frontmatter 中的 description */
    description: string | null;
    /** 语义类型 */
    type: MemorySemanticType | undefined;
    /** frontmatter 中的 name */
    name: string | null;
}
/**
 * 扫描记忆目录，提取所有 .md 文件的 frontmatter 信息
 *
 * @param memoryDir 记忆目录路径
 * @param signal 中断信号
 * @returns 按修改时间排序的记忆头列表（最新在前，最多 MAX_MEMORY_FILES 个）
 */
export declare function scanMemoryFiles(memoryDir: string, signal?: AbortSignal): Promise<MemoryHeader[]>;
/**
 * 格式化记忆清单文本
 *
 * 用于提供给 AI 模型进行相关性选择
 *
 * @param memories 记忆头列表
 * @returns 格式化的清单文本
 */
export declare function formatMemoryManifest(memories: MemoryHeader[]): string;
