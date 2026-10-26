import { MinimatchOptions } from 'minimatch';
export declare class GlobUtils {
    /**
     * 验证 glob 模式是否合法
     * @param pattern glob 模式
     * @returns 是否合法
     */
    static isValidPattern(pattern: string): boolean;
    /**
     * 测试文件路径是否匹配 glob 模式
     * @param filePath 文件路径
     * @param pattern glob 模式
     * @param options minimatch 选项
     * @returns 是否匹配
     */
    static match(filePath: string, pattern: string, options?: MinimatchOptions): boolean;
    /**
     * 标准化路径分隔符
     * @param filePath 文件路径
     * @returns 标准化后的路径（\ → /）
     */
    static normalizePath(filePath: string): string;
}
