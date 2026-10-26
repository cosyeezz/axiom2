import { FileSystem, LocalStorage, LocalStorageChangeEvent } from '@genie/runtime';
export declare class MemoryLocalStorage implements LocalStorage {
    protected readonly fileSystem: FileSystem;
    private emitter;
    changeEvent: import("@celljs/core").Event<LocalStorageChangeEvent>;
    /**
     * server 面缺省 no-op（CODEBUDDY_DISABLE_LOCAL_STORAGE=1）：消费者全是
     * 交互产品面（问卷冷却、输入历史等），pod 上无消费者；写盘还会把多租户
     * 状态混进进程全局文件。no-op 而非内存 Map——假共享不如无共享。
     */
    private get disabled();
    set<T>(key: string, value: T): Promise<void>;
    getSync<T>(key: string, defaultValue?: T): T | undefined;
    get<T>(key: string, defaultValue?: T): Promise<T | undefined>;
    remove(key: string): Promise<void>;
    private resolveEntryPath;
}
