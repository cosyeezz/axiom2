import { Logger } from '@celljs/core';
import { GetMemoryOptions, Memory, MemoryCache, MemoryLoader, MemoryManager, MemoryScope } from './memory-protocol';
export declare class MemoryManagerImpl implements MemoryManager {
    protected readonly memoryLoader: MemoryLoader;
    protected readonly memoryCache: MemoryCache;
    protected readonly logger: Logger;
    protected initialize(): void;
    get(options?: GetMemoryOptions): Promise<Memory[]>;
    addFact(fact: string, scope: MemoryScope): Promise<void>;
    write(content: string, scope: MemoryScope): Promise<void>;
    clear(): void;
    /**
     * 根据选项过滤 memory 列表
     */
    private filterMemories;
    /**
     * 将新项插入到 memory section 中
     */
    private insertIntoMemorySection;
    /**
     * 确保内容末尾有正确的换行分隔
     */
    private ensureNewlineSeparation;
}
