import { Logger } from '@celljs/core';
import { SettingsManager } from '../settings';
import { DirectoryTrustService } from './permission-protocol';
export declare class DirectoryTrustServiceImpl implements DirectoryTrustService {
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    private trustedDirectories;
    private trustAll;
    private initializedDeferred;
    private trustDirDeferred;
    private pendingSave;
    isTrustDirectoryPromise: Promise<void>;
    initialized: Promise<void>;
    isTrustDirectory: boolean;
    protected init(): void;
    /**
     * 检查目录是否为危险目录
     */
    isDangerousDirectory(dirPath: string): boolean;
    private normalizePath;
    /**
     * 判断目标路径是否匹配信任规则（支持 glob 通配符）
     * @param pattern 信任规则，可以是精确路径或 glob 模式（如 /path/** 表示递归信任）
     * @param targetPath 要检查的目标路径
     */
    private matchTrustPattern;
    /**
     * 检查目录是否需要显示授权提示
     */
    needsAuthorization(dirPath: string): boolean;
    /**
     * 信任目录
     * @param dirPath 要信任的目录路径
     * @param permanent 是否永久保存（危险目录建议为 false）
     * @param recursive 是否递归信任子目录（为 true 时会添加 /** 后缀）
     */
    trustDirectory(dirPath: string, permanent?: boolean, recursive?: boolean): void;
    /**
     * 加载已信任的目录
     */
    private doInit;
    flush(): Promise<boolean>;
    /**
     * 保存已信任的目录
     *
     * 用 update 而不是 set：配置文件损坏时 set 静默跳过写入、不抛错，
     * 只有 update 的 applied 能如实反映"是否落盘"。
     *
     * 只把本进程新信任的条目并进 USER 档磁盘上的当前值：内存里的列表是
     * 所有 scope 的合并视图（含项目 / CLI --settings 下发的条目），整份回写会把
     * 它们提升成全局信任；且锁内基于最新磁盘值合并，不会覆盖其它进程刚写入的条目。
     */
    private saveTrustedDirectories;
}
