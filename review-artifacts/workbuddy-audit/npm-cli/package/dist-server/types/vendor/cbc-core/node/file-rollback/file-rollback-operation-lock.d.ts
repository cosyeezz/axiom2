import { type FileRollbackOperationLock as FileRollbackOperationLockContract } from './file-rollback-service-protocol';
/** 基于 Promise 链实现的轻量 session 级互斥锁。 */
export declare class FileRollbackOperationLockImpl implements FileRollbackOperationLockContract {
    private readonly tails;
    runExclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=file-rollback-operation-lock.d.ts.map