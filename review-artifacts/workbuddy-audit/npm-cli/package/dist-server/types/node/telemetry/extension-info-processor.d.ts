import { ClientInfoProvider } from '@genie/product';
import { EventProcessContext, EventProcessor } from '@genie/telemetry';
/**
 * 扩展插件相关信息
 */
export declare class ExtensionInfoEventProcessor implements EventProcessor {
    protected clientInfoProvider: ClientInfoProvider;
    process({ event }: EventProcessContext): Promise<void>;
}
export declare class ExtensionInfoModelEventProcessor implements EventProcessor {
    protected clientInfoProvider: ClientInfoProvider;
    process({ event }: EventProcessContext): Promise<void>;
}
