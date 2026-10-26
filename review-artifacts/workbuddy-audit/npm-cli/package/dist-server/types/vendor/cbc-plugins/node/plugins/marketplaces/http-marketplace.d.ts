import { ProgressCallback } from '../plugin-protocol';
import { DirectoryMarketplace } from './directory-marketplace';
/**
 * HTTP类型的市场实现类
 */
export declare class HttpMarketplace extends DirectoryMarketplace {
    /** 上次成功命中的远端元数据目录，用于后续插件探测时优先尝试 */
    private detectedMetaDir?;
    /**
     * 安装或更新HTTP市场到本地
     * HTTP市场需要下载marketplace.json和所有插件的plugin.json到本地缓存
     */
    install(onProgress?: ProgressCallback): Promise<void>;
    /**
     * 更新HTTP市场
     * 重新下载marketplace.json和插件信息
     */
    update(onProgress?: ProgressCallback): Promise<boolean>;
    /**
     * 获取marketplace.json内容
     */
    private fetchManifest;
    /**
     * 下载marketplace.json到本地
     */
    private downloadManifest;
    private downloadPluginManifest;
    private fetchJson;
    /** Compare complete metadata snapshots so a successful no-op refresh stays idempotent. */
    private haveSameSnapshot;
    private readSnapshotFiles;
    /**
     * 根据URL生成临时名称（用于初始下载）
     */
    private generateNameFromUrl;
    /**
     * 获取HTTP URL
     * 从source中提取HTTP地址，source.url实际指向marketplace.json
     */
    private getHttpUrl;
    /**
     * 构建完整URL
     */
    private buildUrl;
    private safeRemove;
}
//# sourceMappingURL=http-marketplace.d.ts.map