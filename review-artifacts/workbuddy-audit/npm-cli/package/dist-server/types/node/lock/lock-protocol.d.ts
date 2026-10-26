/**
 * 文件锁配置选项
 */
export interface FileLockOptions {
    /** Shared persistent resources must retain cross-process exclusion even in an in-process server. */
    crossProcess?: boolean;
    /**
     * 最大重试次数（默认 5）
     */
    maxRetries?: number;
    /**
     * 重试间隔，毫秒（默认 500）
     */
    retryDelay?: number;
    /**
     * 锁的过期时间，毫秒（默认 5 分钟）
     */
    staleTimeout?: number;
}
/**
 * 跨进程文件锁服务接口
 */
export interface FileLockService {
    /**
     * 获取跨进程文件锁
     * @param lockName 锁的唯一标识（会用于生成锁文件名）
     * @param options 锁的配置选项
     * @returns 释放函数
     */
    acquireFileLock(lockName: string, options?: FileLockOptions): Promise<() => Promise<void>>;
}
/**
 * 文件锁服务的协议标识
 */
export declare const FileLockService: unique symbol;
