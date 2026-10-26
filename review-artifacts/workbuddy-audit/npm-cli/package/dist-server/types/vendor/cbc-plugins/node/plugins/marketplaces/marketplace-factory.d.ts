import { ContainerUtil } from '@celljs/core';
import { Marketplace, MarketplaceInfo } from '../plugin-protocol';
/**
 * Marketplace工厂类
 * 根据source类型创建不同的Marketplace实例
 */
export declare class MarketplaceFactory {
    /**
     * 从JSON对象创建对应类型的Marketplace实例
     */
    static createFromJSON(marketplaceInfo: MarketplaceInfo, services?: typeof ContainerUtil): Marketplace;
}
//# sourceMappingURL=marketplace-factory.d.ts.map