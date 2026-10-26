/**
 * #144842 marketplaces/ 目录的计量与观测工具。
 *
 * 两个用途：
 * - measureDirectoryBytes：清理阶段删除目录前计量字节/文件数（带时间预算，超限截断），
 *   让清理日志能报 removedBytes/removedFiles，「跑了但什么都没删」在日志里可见；
 * - observeStaleUnregisteredMarketplaceDirs：观测版回收（只记录不删除）——找出
 *   marketplaces/ 第一层中「无注册引用、不在保留名单、mtime 超阈值」的目录，
 *   为后续是否开启真实删除积累线上数据（误删会话级注册目录的风险先用数据排除）。
 */
export interface DirectoryBytesResult {
    bytes: number;
    files: number;
    /** 计量因时间预算耗尽被截断，bytes/files 为下限。 */
    truncated: boolean;
}
/** 递归估算文件/目录的字节数与文件数（带时间预算；只为计量，不抛错）。 */
export declare function measureDirectoryBytes(target: string, budgetMs?: number): Promise<DirectoryBytesResult>;
/**
 * 不由 PluginManager 注册表管理的 marketplaces/ 第一层目录（保留名单）。
 * experts/my-experts/plugin-data 由 expert 运行时自己维护，且 experts 通过会话级
 * extraKnownMarketplaces 注册、不落 known_marketplaces.json——按注册表判孤儿会误删。
 */
export declare const MARKETPLACE_RESERVED_DIR_NAMES: ReadonlySet<string>;
/** 观测候选的默认年龄阈值：30 天未写入。 */
export declare const STALE_MARKETPLACE_DIR_MIN_AGE_MS: number;
/** 名字是否属于 sweeper 负责的事务产物（与清理阶段同口径，含时间戳畸形的保守命中）。 */
export declare function isMarketplaceTransientArtifactName(entryName: string): boolean;
export interface StaleMarketplaceDirObservation {
    name: string;
    ageDays: number;
    approxBytes: number;
    approxFiles: number;
    /** 计量被时间预算截断，approxBytes/approxFiles 为下限。 */
    measureTruncated: boolean;
}
export interface ObserveStaleMarketplaceDirsOptions {
    marketplacesRoot: string;
    /** 已注册市场的 installLocation（path.resolve 之后）。 */
    registeredLocations: ReadonlySet<string>;
    /** 已注册市场的 storageName || name。 */
    registeredNames: ReadonlySet<string>;
    reservedNames?: ReadonlySet<string>;
    minAgeMs?: number;
    /** 单目录计量时间预算。 */
    measureBudgetMs?: number;
    now?: () => number;
}
/**
 * 观测版「未注册 stale 目录」候选扫描：只返回候选清单，绝不删除。
 * 命中条件：第一层目录 + 无注册引用（路径与名字都不在注册表）+ 不在保留名单 + mtime 超阈值。
 * staging、backup、source-* 暂存目录与 publish journal 等事务产物不在此列
 * （由 cleanup-marketplace-transients 处理）。
 */
export declare function observeStaleUnregisteredMarketplaceDirs(options: ObserveStaleMarketplaceDirsOptions): Promise<StaleMarketplaceDirObservation[]>;
//# sourceMappingURL=marketplace-dir-measure.d.ts.map