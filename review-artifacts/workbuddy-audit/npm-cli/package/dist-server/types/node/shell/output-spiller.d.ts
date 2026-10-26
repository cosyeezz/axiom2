/**
 * OutputSpiller - 流式将完整输出写入磁盘临时文件。
 *
 * 与 TruncateBuffer 配合使用：TruncateBuffer 在内存中只保留 head+tail（给 LLM），
 * OutputSpiller 将完整输出流式写入磁盘（供用户按需读取）。
 *
 * 使用方式：
 *   const spiller = new OutputSpiller(filePath);
 *   // 在每次收到数据时同时 push
 *   spiller.push(chunk);
 *   // 完成后关闭
 *   await spiller.close();
 *   // 获取文件路径和总字节数
 *   spiller.filePath;  // 磁盘文件路径
 *   spiller.totalBytes; // 写入的总字节数
 */
export declare class OutputSpiller {
    readonly filePath: string;
    private stream;
    private _totalBytes;
    private _closed;
    private _hasError;
    constructor(filePath: string);
    push(data: string): void;
    close(): Promise<void>;
    get totalBytes(): number;
    get hasError(): boolean;
    get isClosed(): boolean;
    /**
     * Remove the spill file (e.g. if output wasn't actually truncated).
     *
     * Closes the underlying WriteStream first to release the fd; otherwise the
     * stream lingers until V8 GC collects it, at which point Node logs
     * "Closing file descriptor X on garbage collection" and may throw EBADF
     * if the fd number was reused. See bash-tool auto-background path where
     * cleanup() runs without buildForegroundResult having closed the spiller.
     */
    cleanup(): Promise<void>;
}
