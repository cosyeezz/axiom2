import { ReleasesService } from './install-protocol';
interface ReleasesConfig {
    packageName: string;
    baseUrl: string;
    filenamePattern?: (platform: string, arch: string) => string;
}
export declare class ReleasesServiceImpl implements ReleasesService {
    /**
     * `config.baseUrl` 是**类字段初值**，构造时立即根据 Capabilities 决定：
     * - 官方版 / 定制版禁用更新形态：走官方 COS
     * - 定制版启用客户源：走 `customUpdateSource.baseUrl`（客户自建 COS）
     *
     * 之前 baseUrl 是硬编码常量，客户包升级
     * 会跳回官方版；现在同一个 releases-service 按能力表分派。
     *
     * 说明：只在构造时计算一次。Capabilities 依赖的 snapshot 在 bootstrap 阶段已冻结，
     * 进程生命周期内不变，无需订阅或重算。
     */
    config: ReleasesConfig;
    /** Fetches latest version from {baseUrl}/latest */
    getLatestVersion(): Promise<string>;
    /** Returns download URL for the release artifact */
    getDownloadUrl(version: string, os: {
        platform: () => NodeJS.Platform;
        arch: () => NodeJS.Architecture;
    }): string;
    static defaultFilenamePattern(packageName: string, platform: string, arch: string): string;
}
export {};
