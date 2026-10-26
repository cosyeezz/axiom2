import { Logger } from '@genie/telemetry';
import { ChannelSecurityManager } from './channel-protocol';
export declare class ChannelSecurityManagerImpl implements ChannelSecurityManager {
    protected readonly logger: Logger;
    private allowlists;
    initializeAllowlist(channelName: string): Promise<Set<string>>;
    isAllowedSender(channelName: string, senderId: string): Promise<boolean>;
    addSender(channelName: string, senderId: string): Promise<void>;
    removeSender(channelName: string, senderId: string): Promise<void>;
    private saveAllowlist;
    private getAllowlistPath;
}
