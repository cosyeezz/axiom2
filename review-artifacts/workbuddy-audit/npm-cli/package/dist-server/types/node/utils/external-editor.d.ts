/**
 * 编辑器打开结果
 */
export interface EditorResult {
    filePath: string;
    content: string;
    success: boolean;
    error?: string;
}
/**
 * 外部编辑器工具类
 */
export declare abstract class ExternalEditorUtils {
    /**
     * 检测命令是否可用（通过 which/where 判断，不实际执行命令）。
     *
     * 走 argv 数组而非 shell 字符串：本方法的入参最终来自 $VISUAL / $EDITOR，
     * 拼进 shell 字符串就等于把环境变量当代码执行。
     */
    static isCommandAvailable(command: string): boolean;
    /**
     * 获取可用的编辑器
     */
    static getAvailableEditor(): string | undefined;
    /**
     * 创建临时文件
     */
    static createTempFile(content?: string): string;
    /**
     * 把 $VISUAL / $EDITOR 值切成 argv：按空白分词，双/单引号包裹的段视为单个
     * token（引号剥掉）。覆盖 shell 用户的两种常见写法：`vim -R` 与
     * `"C:\Program Files\...\Code.exe" --wait`。不做转义/嵌套引号等完整 shell
     * 语法——那是把 shell 请回来，注入面也跟着回来。
     */
    static tokenizeEditorCommand(command: string): string[];
    /**
     * 使用外部编辑器打开文件（同步阻塞，直到用户关闭编辑器）
     */
    static openWithExternalEditor(filePath: string, initialContent?: string): void;
    /**
     * 启动外部编辑器并读取编辑结果
     */
    static launchExternalEditor(initialContent?: string): Promise<EditorResult>;
    /**
     * 获取编辑器信息提示
     */
    static getEditorInfo(editor?: string): string;
}
