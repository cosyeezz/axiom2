import { Logger } from '@genie/telemetry';
import { Memory, MemoryParser, MemoryValidator, SubdirectoryMemoryLoader } from './memory-protocol';
export declare class SubdirectoryMemoryLoaderImpl implements SubdirectoryMemoryLoader {
    protected readonly parser: MemoryParser;
    protected readonly validator: MemoryValidator;
    protected readonly logger: Logger;
    private chainCache;
    private dirCache;
    private fileCache;
    protected initialize(): void;
    loadForPaths(filePaths: string[]): Promise<Memory[]>;
    clear(): void;
    /**
     * 加载指定目录到 workDir 之间所有目录的 memory
     * @param dirPath 目录路径
     * @param workDir 工作目录
     * @returns memory 列表
     */
    private loadForDirectory;
    /**
     * 加载单个目录的 memory
     * @param dirPath 目录路径
     * @param workDir 工作目录
     * @returns memory 或 undefined
     */
    private loadDirMemory;
    /**
     * 转换用户定义的 globs 为基于 workDir 的路径
     * @param userGlobs 用户定义的 globs
     * @param relativeDirPath 相对于 workDir 的目录路径
     * @returns 转换后的 globs，无有效 globs 时返回默认目录 glob
     */
    private resolveGlobs;
    /**
     * 将单个 glob 转换为基于 workDir 的路径
     * @param glob 原始 glob 模式
     * @param relativeDirPath 相对于 workDir 的目录路径
     * @returns 转换后的 glob，绝对路径保留，.. 开头返回 undefined
     */
    private resolveGlobToWorkDir;
    /**
     * 查找目录下的 memory 文件
     * @param dirPath 目录路径
     * @returns memory 文件路径或 undefined
     */
    private findMemoryFile;
    /**
     * 检查路径是否在父路径内
     */
    private isSubPath;
    /**
     * 检查目录是否在产品目录（.codebuddy / 定制版 .xxxcode）内
     */
    private isInsideProductDir;
}
