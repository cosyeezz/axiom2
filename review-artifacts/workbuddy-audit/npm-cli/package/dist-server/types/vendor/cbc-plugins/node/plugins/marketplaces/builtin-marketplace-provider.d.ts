import { ContainerUtil } from '@celljs/core';
import { ProductConfigurationContext } from '@genie/product';
import { Logger } from '@genie/telemetry';
import { BuiltInMarketplaceProvider, MarketplaceConfigEntry, MarketplaceSource } from '../plugin-protocol';
export declare class BuiltInMarketplaceProviderImpl implements BuiltInMarketplaceProvider {
    protected componentServices?: typeof ContainerUtil;
    protected get services(): typeof ContainerUtil;
    protected readonly logger: Logger;
    protected readonly executionConfiguration?: ProductConfigurationContext;
    /**
     * 绑定配置身份，靠每轮同步发布的新快照自然失效。裸 Set 会把"配置里暂时没有内置市场"
     * （定制版 `builtInMarketplaces: {}` 即此形态）固化成空集，之后永远判不出内置市场（#119844）。
     */
    private builtInNamesCache?;
    protected init(): void;
    /**
     * 只读已发布配置：`getCurrentConfiguration()` 会暴露 doSync 逐个 provider 合并的中间态
     * （打包 product.json 已合并、ENV 下发的带版本号 URL 尚未覆盖），据此对比会误判 source
     * 变化并整包重装（#119844）。
     *
     * 尚未发布时返回 undefined 而不是回退读中间态：此时没有任何一层声明过期望状态，猜一个
     * 出来就会按从未被声明的状态改写共享的市场存储。首次发布必然 fire `onDidChange`，
     * 热加载会补跑安装（PluginManager 的 `wait-builtin-marketplace-refresh` 阶段）。
     */
    private getPublishedConfiguration;
    /**
     * #83869 builtin 市场静态资源 URL（市场 zip / version / meta）解析：
     * enterprise 模式（UseEnterpriseDownloadSource + endpoint 就绪）下命中 SaaS
     * 静态域名表的 URL 整域名改写为 {endpoint}{path}；saas / 未命中原样返回。
     * 幂等：已改写的企业 URL 不会二次改写。
     */
    private resolveMarketplaceUrl;
    /**
     * 获取所有内置市场配置
     * 将对象结构转换为带名称的数组结构
     */
    getBuiltInMarketplaces(): Promise<MarketplaceConfigEntry[]>;
    /**
     * 检查指定市场是否为内置市场
     */
    isBuiltInMarketplace(name: string): Promise<boolean>;
    getVersionUrl(name: string): Promise<string | undefined>;
    /**
     * 将市场配置转换为 MarketplaceSource
     */
    toMarketplaceSource(config: MarketplaceConfigEntry): MarketplaceSource;
}
//# sourceMappingURL=builtin-marketplace-provider.d.ts.map