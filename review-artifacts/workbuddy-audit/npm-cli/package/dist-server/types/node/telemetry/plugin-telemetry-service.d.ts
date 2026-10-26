import { EventService, Logger } from '@genie/telemetry';
import { MarketplaceActionData, MarketplacePageShowData, PluginActionData, PluginTelemetryService } from './plugin-telemetry-protocol';
export declare class PluginTelemetryServiceImpl implements PluginTelemetryService {
    protected readonly eventService: EventService;
    protected readonly logger: Logger;
    reportMarketplaceAction(data: MarketplaceActionData): void;
    reportMarketplacePageShow(data: MarketplacePageShowData): void;
    reportPluginAction(data: PluginActionData): void;
    /**
     * 获取市场来源字符串
     */
    private getMarketplaceSource;
    /**
     * 映射市场类型到埋点定义的类型
     * directory -> local
     * github/git/url -> github
     */
    private mapMarketplaceType;
    /**
     * 映射安装作用域到埋点定义的类型
     */
    private mapScope;
    /**
     * 获取插件能力标志
     */
    private getPluginCapabilities;
    /**
     * 判断能力是否存在
     */
    private hasCapability;
}
