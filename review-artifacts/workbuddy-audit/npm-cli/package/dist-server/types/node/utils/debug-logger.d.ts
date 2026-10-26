/**
 * 调试日志写入工具
 * 用于将内部错误和调试信息写入到文件系统，而不是输出到 console
 * 日志文件位置: ~/.codebuddy/logs/debug.log
 */
export declare class DebugLogger {
    private static logDirPromise;
    private static readonly pidPrefix;
    /**
     * 初始化日志目录
     */
    private static ensureLogDir;
    /**
     * 写入错误日志
     * @param component 组件名称（如 'AcpUtils'）
     * @param message 错误消息
     * @param error 错误对象
     */
    static error(component: string, message: string, error?: unknown): Promise<void>;
    /**
     * 写入警告日志
     * @param component 组件名称
     * @param message 警告消息
     */
    static warn(component: string, message: string): Promise<void>;
    /**
     * 格式化错误对象为字符串
     */
    private static formatError;
}
