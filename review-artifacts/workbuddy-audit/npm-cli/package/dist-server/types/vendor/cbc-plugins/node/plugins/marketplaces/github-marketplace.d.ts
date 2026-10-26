import { ProgressCallback } from '../plugin-protocol';
import { DirectoryMarketplace } from './directory-marketplace';
/**
 * GitHub类型的市场实现类
 */
export declare class GithubMarketplace extends DirectoryMarketplace {
    /**
     * 安装或更新GitHub仓库到本地
     */
    install(onProgress?: ProgressCallback): Promise<void>;
    /**
     * clone 完成后根据 marketplace.json 里的 name rename 目录。
     *
     * 不复用 HttpMarketplace 的 tempLocation 预建方式：Git marketplace 的 manifest
     * 是随 clone 一并下来的，install 开始时读不到 —— 因此只能在 update() 之后回头调整。
     *
     * rename 失败不抛异常：clone 已成功，稳住旧目录名仍可继续工作，由上层的
     * known_marketplaces.json 记录 installLocation 做后续定位。
     * 不安全的 manifest.name（路径穿越）忽略，同样保留 slug 目录 (#71947)。
     */
    private renameToManifestName;
    /**
     * 读取 installLocation 下的 marketplace.json 获取 name 字段
     * 遍历所有支持的 metadata 目录（.codebuddy-plugin / .claude-plugin）
     */
    private readManifestName;
    private readMarketplaceManifest;
    update(onProgress?: ProgressCallback): Promise<boolean>;
    private readRepoState;
    /**
     * 克隆Git仓库
     * clone 失败时清理残留目录，避免后续 update 误判为已有仓库
     */
    private cloneRepo;
    private swapDirectoryFromStaging;
    /**
     * 获取Git URL
     * 从source中提取Git仓库地址
     */
    private getGitUrl;
}
//# sourceMappingURL=github-marketplace.d.ts.map