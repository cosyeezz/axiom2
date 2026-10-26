export declare const DirectoryTrustService: unique symbol;
export interface DirectoryTrustService {
    initialized: Promise<void>;
    isTrustDirectory: boolean;
    isTrustDirectoryPromise: Promise<void>;
    needsAuthorization(dirPath: string): boolean;
    trustDirectory(dirPath: string, permanent?: boolean, recursive?: boolean): void;
    /**
     * 等待 trustDirectory 触发的持久化写盘落定（写完即退出的短进程要用它）。
     * 返回迄今所有持久化写入是否都已落盘（每次只写自己的条目，任一失败即为 false）。
     */
    flush(): Promise<boolean>;
    isDangerousDirectory(dirPath: string): boolean;
}
