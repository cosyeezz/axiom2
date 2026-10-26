import { FileLockService } from '../../../../../node/lock/index.js';
import { Logger } from '@genie/telemetry';
import { MarketplaceInfo, MarketplaceStorage, PluginErrorCollector } from '../plugin-protocol';
/**
 * 市场存储实现
 * 负责管理市场配置的持久化
 *
 * 并发与原子性保证：
 * 1. 进程内：`writeLock` Promise 链串行化 read-modify-write，避免同一进程内的 lost-update。
 * 2. 跨进程：`FileLockService` 互斥锁，防止多 CLI/Gateway/Desktop 实例同时写同一份 JSON 导致字节级交错。
 * 3. 原子写：`tempFile + rename`，即便锁意外失效，读者也只会看到旧版本或新版本，绝不会看到半成品。
 * 4. 自愈：读到无法解析的 JSON 时只在同一写锁内复查、备份为 `.broken-<ts>`，
 *    再由真实 mutation 重建；只读路径绝不创建/覆盖 registry。
 */
export declare class MarketplaceStorageImpl implements MarketplaceStorage {
    protected installsDisabled(): boolean;
    protected readonly logger: Logger;
    protected readonly errorCollector: PluginErrorCollector;
    protected readonly fileLockService: FileLockService;
    /** 市场配置文件路径 */
    private readonly configFilePath;
    /** 当前配置目录检查的 single-flight；完成后释放以支持外部删除后的自愈。 */
    private configFileInitPromise?;
    /** 序列化写操作，防止并发 read-modify-write 丢失更新（进程内） */
    private writeLock;
    constructor();
    protected init(): void;
    /**
     * 进程内写锁：确保同一进程内的写操作串行执行。
     */
    private withWriteLock;
    /**
     * 跨进程文件锁：确保多进程间的写操作互斥。
     * 获取失败时必须终止写入。仅进程内锁无法阻止另一个 CLI 基于旧快照
     * 覆盖 known_marketplaces.json，原子 rename 只能防半文件，不能防 lost-update。
     */
    private withFileLock;
    /**
     * 同时获取进程内锁与跨进程锁。
     */
    private withLocks;
    private sanitizeLockName;
    /** Ensure only the parent directory. Readers must never create registry data. */
    private ensureConfigFileAsync;
    /**
     * 实际执行配置文件初始化
     */
    private doEnsureConfigFile;
    /**
     * Read the registry without mutating it. A caller that already holds the
     * storage write lock may opt into corruption repair; only that path backs
     * up the broken snapshot and returns an empty object for the subsequent
     * atomic write. Unlocked readers surface a typed error so they cannot race
     * a healthy writer with a repair rename.
     */
    private readAndRepair;
    private getPublishingMarketplaceNames;
    private sameStringSet;
    /**
     * Journal/registry seqlock for unlocked readers. The marketplace-name lock
     * remains the authoritative boundary for mutable-source copying, but this
     * prevents list/browse callers from constructing a Marketplace from the
     * obvious stable-swap window.
     */
    private readConsistentMarketplaceSnapshot;
    /**
     * Older WorkBuddy builds registered a generated marketplace root inside
     * `plugins/cache`. Keep detecting those records for compatibility, but
     * never move cache contents into `plugins/marketplaces`.
     *
     * Claude keeps these trees independent:
     * - marketplaces/<marketplace> is the mutable source checkout
     * - cache/<marketplace>/<plugin>/<version> is an immutable install snapshot
     */
    private hasRepairableLegacyMarketplaceCacheReferences;
    private getCanonicalMarketplaceLocation;
    /**
     * Repair only the storage reference when a real canonical marketplace
     * source already exists. Cache-only legacy records are intentionally left
     * untouched: moving them would turn installed snapshots into a marketplace
     * source and destroy the cache/source boundary.
     */
    private repairLegacyMarketplaceCacheReferences;
    private isMarketplaceRoot;
    /**
     * 原子写：写入临时文件后 rename 到目标路径。
     * 同一文件系统内 rename 是原子操作，读者要么看到旧文件要么看到新文件，
     * 绝不会看到"被截断后正在写入"的半成品。
     */
    private atomicWriteJson;
    /**
     * 生成与 pid/时间戳/随机串绑定的临时文件名，避免多进程冲突。
     * 抽成实例方法以便测试替换。
     */
    protected generateTempPath(): string;
    /**
     * 底层写入临时文件。抽成实例方法以便测试替换而不污染 `fs-extra` 模块属性。
     */
    protected writeTempFile(tempPath: string, content: string): Promise<void>;
    /**
     * 底层原子 rename，带 Windows EPERM/EBUSY/EACCES 重试。抽成实例方法以便测试替换。
     *
     * 背景：Windows 上 `rename` 覆盖已存在的目标文件需要对目标持有 DELETE 权限。
     * 当杀软 / 索引器 / 并发的无锁读取者（getMarketplaces → readAndRepair 读取
     * known_marketplaces.json 时不加锁）持有目标文件的句柄且未带 FILE_SHARE_DELETE 时，
     * 替换式 rename 会抛 `EPERM: operation not permitted, rename ...`，进而冒泡成
     * 删除市场 HTTP 500。这类占用几乎都是瞬时的（占用方几十毫秒内即释放），
     * 因此做短退避重试即可扛住，而不改变 temp+rename 的原子写语义。
     *
     * 注意：刻意不做 copyFile 兜底——copyFile 非原子，会让读取者看到半成品。
     * 保持纯 rename
     * 重试，既消除该风险，又覆盖现实中绝大多数瞬时 EPERM。重试耗尽仍失败时
     * 抛出原始 rename 错误，保留诊断信息。
     */
    protected renameTempFile(tempPath: string, targetPath: string): Promise<void>;
    /**
     * 底层 fs.rename。抽成实例方法以便测试注入失败（fs-extra 的导出方法不可 stub）。
     */
    protected rawRename(tempPath: string, targetPath: string): Promise<void>;
    /**
     * 底层清理临时文件（best-effort）。抽成实例方法以便测试替换与断言。
     */
    protected removeTempFile(tempPath: string): Promise<void>;
    /**
     * 获取所有市场配置
     */
    getMarketplaces(options?: {
        includePublishing?: boolean;
    }): Promise<MarketplaceInfo[]>;
    /**
     * 保存市场配置
     */
    saveMarketplace(marketplace: MarketplaceInfo): Promise<void>;
    /**
     * 删除市场配置
     */
    removeMarketplace(name: string): Promise<void>;
    /**
     * 检查市场是否已安装
     */
    isMarketplaceInstalled(name: string): Promise<boolean>;
}
//# sourceMappingURL=marketplace-storage.d.ts.map