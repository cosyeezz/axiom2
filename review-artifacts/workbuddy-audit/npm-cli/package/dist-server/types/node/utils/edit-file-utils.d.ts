/**
 * 文件读取结果
 */
export interface FileReadResult {
    content: string | undefined;
    exists: boolean;
    lineEnding?: 'CRLF' | 'LF' | 'MIXED';
    encodingInfo?: {
        encoding: string;
        confidence: number;
        hasBom: boolean;
        bomType?: string;
    };
    error?: {
        display: string;
        raw: string;
    };
}
/**
 * 编辑操作结果
 */
export interface EditOperationResult {
    currentContent: string | undefined;
    newContent: string;
    error?: {
        display: string;
        raw: string;
    };
    isNewFile: boolean;
}
/**
 * 文本替换结果(包含受影响的行号)
 */
export interface TextReplacementResult {
    newContent: string;
    affectedLines: number[];
}
/**
 * 包含一些通用的文件编辑操作工具
 */
export declare abstract class EditFileUtils {
    static validateToolParams(params: {
        file_path: string;
    }): string | undefined;
    /**
     * 读取文件内容并标准化行结束符,支持多种编码
     */
    static readFileContent(filePath: string): Promise<FileReadResult>;
    /**
     * 应用文本替换(支持模糊匹配标点符号和空白符)
     * 包含多重匹配检测和智能换行处理
     */
    static applyTextReplacement(currentContent: string | undefined, oldString: string, newString: string, isNewFile: boolean, replaceAll?: boolean): string;
    /**
     * 替换字符串中第一次出现的目标字符串
     * 使用字面量匹配，避免正则元字符问题
     */
    private static replaceFirst;
    /**
     * 计算字符串在文本中出现的次数
     */
    private static countOccurrences;
    /**
     * 增强的模糊字符串查找(处理标点符号差异、空白符差异)
     * 实现多种匹配策略,按优先级依次尝试
     */
    private static fuzzyFindString;
    /**
     * 通过标点符号标准化查找字符串
     */
    private static findStringByPunctuationNormalization;
    /**
     * 通过空白符标准化查找字符串
     * 处理每行首尾空白差异,同时保留换行符
     */
    private static findStringByWhitespaceNormalization;
    /**
     * 验证编辑操作
     */
    static validateEditOperation(fileExists: boolean, oldString: string, newString: string, currentContent: string | undefined, isMultiEdit?: boolean): {
        isValid: boolean;
        error?: {
            display: string;
            raw: string;
        };
    };
    /**
     * 写入文件内容,支持多种编码和行尾符恢复
     */
    static writeFileContent(filePath: string, content: string, lineEnding?: 'CRLF' | 'LF' | 'MIXED', encodingInfo?: {
        encoding: string;
        confidence: number;
        hasBom: boolean;
        bomType?: string;
    }): Promise<void>;
    /**
     * 应用文本替换并计算受影响的行号
     * 用于 ACP 场景下需要向客户端报告 affectedLines
     *
     * @param fileContent - 文件内容
     * @param edits - 编辑操作数组
     * @returns 新内容和受影响的行号数组
     */
    static applyTextReplacementWithLocation(fileContent: string, edits: Array<{
        oldString: string;
        newString: string;
        replaceAll?: boolean;
    }>): TextReplacementResult;
}
