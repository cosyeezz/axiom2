import type { Memory } from '../memory/memory-protocol';
/**
 * Memory 加载上下文
 *
 * 用于在加载过程中跟踪状态，支持：
 * - 已加载文件去重（loadedMemories）
 * - 循环引用检测（visitedFilePaths）
 * - 符号链接去重（visitedDirectories）
 * - 导入深度限制（importDepth）
 */
export interface MemoryLoadContext {
    /** 已加载的 Memory（使用 realpath 作为 key） */
    readonly loadedMemories: Map<string, Memory>;
    /** 当前导入链中已访问的文件路径（用于循环检测） */
    readonly visitedFilePaths: Set<string>;
    /** 已访问的目录真实路径（用于符号链接去重） */
    readonly visitedDirectories: Set<string>;
    /** 当前导入深度 */
    readonly importDepth: number;
}
/**
 * Memory 加载上下文工具类
 *
 * 提供加载上下文的创建和管理功能
 */
export declare abstract class MemoryLoadContextUtils {
    /**
     * 创建新的加载上下文
     */
    static create(): MemoryLoadContext;
    /**
     * 创建子上下文（用于递归导入）
     *
     * 子上下文共享 loadedMemories 和 visitedDirectories，但复制 visitedFilePaths，
     * 这样每条导入链有独立的循环检测，但全局去重是共享的。
     */
    static createChild(parent: MemoryLoadContext): MemoryLoadContext;
}
