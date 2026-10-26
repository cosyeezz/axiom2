import { FileLockOptions, FileLockService } from './lock-protocol';
/**
 * 跨进程文件锁服务实现
 */
export declare class FileLockServiceImpl implements FileLockService {
    protected inProcessOnly(): boolean;
    private readonly locks;
    private readonly defaultOptions;
    /**
     * 获取或创建某个锁的 Mutex
     */
    private getLockMutex;
    /**
     * 获取跨进程文件锁
     */
    acquireFileLock(lockName: string, options?: FileLockOptions): Promise<() => Promise<void>>;
    /**
     * 尝试创建锁目录（原子操作）
     */
    private tryCreateLock;
    /**
     * 检查锁是否已过期
     */
    private isLockStale;
    private getCurrentProcessIdentity;
    private isProcessAlive;
    private queryProcessStartIdentity;
    private readProcessIdentity;
    /**
     * 清理路径中的特殊字符，用于生成安全的锁文件名
     */
    private sanitizePath;
}
