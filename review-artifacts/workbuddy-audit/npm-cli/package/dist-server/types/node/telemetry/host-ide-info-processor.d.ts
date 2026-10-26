import { ClientInfoProvider } from '@genie/product';
import { EventProcessContext, EventProcessor } from '@genie/telemetry';
/**
 * 宿主 IDE 相关信息
 */
export declare class HostIDEInfoEventProcessor implements EventProcessor {
    protected clientInfoProvider: ClientInfoProvider;
    process({ event }: EventProcessContext): Promise<void>;
    /**
     * A CLI process serves one conversation, so its client session id identifies
     * it. The library runtime serves every session of its host from one process.
     */
    private runSessionId;
    private ensureLocalCliFeatureModule;
    private isCliIdentity;
}
