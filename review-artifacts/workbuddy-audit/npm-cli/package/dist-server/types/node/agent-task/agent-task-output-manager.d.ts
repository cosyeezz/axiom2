import { Logger } from '@genie/telemetry';
import { AgentTaskOutputFileManager } from './agent-task-protocol';
/**
 * Implementation of agent task output file management.
 *
 * fs 走 sandbox ambient 面（换源即迁移判据）：注入沙箱的会话里 tee 落虚拟
 * 命名空间（pod 真实盘零写入），bin/local 直通逐字不变。写发生在子代理
 * 运行内，ambient sandbox 经 root scope 四 seam 继承解析。
 */
export declare class AgentTaskOutputFileManagerImpl implements AgentTaskOutputFileManager {
    protected readonly logger: Logger;
    init(): void;
    private readonly MAX_FILE_SIZE;
    /** 写透尾环容量（字符 ≈ 字节，工具调用行为 ASCII 主体）。 */
    private readonly RING_CAP;
    /**
     * 写透尾环 + 尺寸账本（remote fs 优化，CC getTaskOutputDelta 同语义面）：
     * 写文件照旧（持久面/宿主可见性不变），同时进程内留最后 RING_CAP 尾窗与
     * 绝对尺寸——running 态进度轮询与 append 前尺寸检查零远端 IO。
     */
    private readonly buffers;
    /**
     * AgentTask 输出属于临时运行资料，复用后台任务的用户隔离根目录。
     * 不再写全局 /tmp/codebuddy，避免多人共用服务器时被首个创建者的目录权限阻断。
     */
    private getDefaultOutputDir;
    /**
     * Ensure the output directory exists
     */
    private ensureOutputDirectory;
    /**
     * Create an output file for a task
     */
    createOutputFile(taskId: string, outputDir?: string): Promise<string>;
    /**
     * Append content to a task's output file
     * This is the main method used during task execution
     */
    appendToOutputFile(filePath: string, content: string): Promise<void>;
    /**
     * Append content to a task's output file by task ID
     * This is a convenience method that resolves the file path internally
     */
    appendToOutputFileById(taskId: string, content: string): Promise<void>;
    readProgressDelta(taskId: string, fromOffset: number): Promise<{
        content: string;
        offset: number;
        omittedBytes: number;
    }>;
    finalizeOutputBuffer(taskId: string): void;
    /**
     * Get the output file path for a task
     */
    getOutputFilePath(taskId: string, outputDir?: string): string;
}
