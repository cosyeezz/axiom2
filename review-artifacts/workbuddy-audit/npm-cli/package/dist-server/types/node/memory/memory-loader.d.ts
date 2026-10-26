import { Logger } from '@genie/telemetry';
import { Memory, MemoryLoader, MemoryParser, MemoryValidator } from './memory-protocol';
/**
 * 收集项目主文件的查找目录：默认从启动目录向上爬到文件系统根（Claude Code parity），
 * parentDiscovery 关闭时只保留启动目录本身。返回顺序自下而上，加载方倒序遍历保证祖先先注入。
 */
export declare function collectProjectMemoryDirs(workDir: string, parentDiscoveryDisabled: boolean): string[];
export declare class MemoryLoaderImpl implements MemoryLoader {
    protected readonly parser: MemoryParser;
    protected readonly validator: MemoryValidator;
    protected readonly logger: Logger;
    protected initialize(): void;
    loadAll(): Promise<Memory[]>;
    /**
     * Map MemoryScope → Claude Code InstructionsLoaded.memory_type.
     */
    private mapScopeToMemoryType;
    /**
     * Fire InstructionsLoaded hooks for each loaded memory file.
     * Skips silently when HookManager is unavailable or no hooks are configured.
     */
    private dispatchInstructionsLoadedHooks;
    /**
     * 加载用户级别的 memory
     */
    private loadUserMemories;
    /**
     * 加载项目级别的 memory
     */
    private loadProjectMemories;
    /**
     * 越界向上查找开关：env CODEBUDDY_DISABLE_PARENT_MEMORY=1 或
     * settings memory.parentDiscovery=false 时只加载启动目录本身，默认保持向上爬升。
     */
    private isParentDiscoveryDisabled;
    /**
     * 加载本地 memory
     */
    private loadLocalMemories;
    /**
     * 加载项目主文件
     */
    private loadProjectMainFiles;
    /**
     * 加载单个 memory 文件
     */
    private loadFile;
    /**
     * 解析文件真实路径
     */
    private resolveRealPath;
    /**
     * 检查是否可以加载（循环引用和深度检查）
     */
    private canLoad;
    /**
     * 加载 memory 中的 import 引用
     */
    private loadImports;
    /**
     * 处理加载错误
     */
    private handleLoadError;
    /**
     * 加载目录下的所有 memory 文件
     */
    private loadDirectory;
    /**
     * 检查是否是支持的文件类型
     */
    private isSupportedFile;
}
