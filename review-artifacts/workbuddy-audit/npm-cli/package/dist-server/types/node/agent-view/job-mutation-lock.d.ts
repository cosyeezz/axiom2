export declare function acquireJobMutationLock(lockPath: string): Promise<() => Promise<void>>;
