export declare abstract class FileHistorySnapshotUtils {
    /** 计算文件路径哈希(SHA256 的前 16 位) */
    static computePathHash(filePath: string): string;
    /**
     * 归一化用于计算哈希的路径,消除 Windows 盘符大小写差异。
     *
     * 备份文件名 = computePathHash(路径)。保存备份(trackFile 用工具传入路径)与读取/回退
     * (从快照相对路径经 process.cwd() 还原)两侧,盘符大小写可能不一致(如 e:\ 与 E:\),
     * 导致同一文件算出不同哈希 → 回退时按一种哈希去找、磁盘却存另一种 → 读不到备份、
     * Restore code 静默失效。这里在 Windows 上统一盘符为大写(平台惯例)以对齐两侧。
     * 非 Windows 平台路径大小写敏感,保持原样。
     */
    private static normalizePathForHash;
    /**
     * 格式化备份文件名
     * 格式: {pathHash}@v{version}
     */
    static formatBackupName(pathHash: string, version: number): string;
}
