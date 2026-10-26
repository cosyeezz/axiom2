/** Serializes run admission, rollback and backup mutations for one session. */
export declare const FileRollbackOperationLock: unique symbol;
export interface FileRollbackOperationLock {
    runExclusive<T>(sessionId: string, operation: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=file-rollback-service-protocol.d.ts.map