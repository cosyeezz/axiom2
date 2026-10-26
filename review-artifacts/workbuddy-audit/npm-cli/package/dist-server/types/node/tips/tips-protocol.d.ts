import { Event } from '@celljs/core';
export declare const TipsManager: unique symbol;
export declare const UserStateManager: unique symbol;
export interface Tip {
    id: string;
    content: string | (() => Promise<string>);
    cooldownSessions: number;
    isRelevant: () => Promise<boolean>;
}
export interface UserState {
    numStartups: number;
    lastPlanModeUse?: number;
    memoryUsageCount: number;
    promptQueueUseCount: number;
    sessionsSinceLastTip: number;
    lastTipShown?: string;
    tipShowHistory: {
        [tipId: string]: {
            count: number;
            lastShown: number;
        };
    };
}
export interface UserStateManager {
    readonly onDidChange: Event<UserState>;
    getState(): Promise<UserState>;
    setState(state: Partial<UserState>): Promise<void>;
    incrementStartup(): Promise<void>;
    updatePlanModeUse(): Promise<void>;
    incrementMemoryUsage(): Promise<void>;
    incrementPromptQueue(): Promise<void>;
    recordTipShown(tipId: string): Promise<void>;
    incrementSession(): Promise<void>;
}
export interface TipsManager {
    getRelevantTip(): Promise<{
        id: string;
        content: string;
    } | undefined>;
    registerTip(tip: Tip): void;
    registerTips(tips: Tip[]): void;
}
