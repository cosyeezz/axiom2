import { Logger } from '@celljs/core';
import { Memory, MemoryCache } from './memory-protocol';
export declare class MemoryCacheImpl implements MemoryCache {
    private cache?;
    protected readonly logger: Logger;
    getOrLoad(loader: () => Promise<Memory[]>): Promise<Memory[]>;
    clear(): void;
}
