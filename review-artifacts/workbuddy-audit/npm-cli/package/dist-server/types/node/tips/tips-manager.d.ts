import { Logger } from '@celljs/core';
import { Tip, TipsManager, UserStateManager } from './tips-protocol';
export declare class TipsManagerImpl implements TipsManager {
    protected readonly logger: Logger;
    protected readonly userStateManager: UserStateManager;
    private tips;
    protected init(): void;
    registerTip(tip: Tip): void;
    registerTips(tips: Tip[]): void;
    getRelevantTip(): Promise<{
        id: string;
        content: string;
    } | undefined>;
}
