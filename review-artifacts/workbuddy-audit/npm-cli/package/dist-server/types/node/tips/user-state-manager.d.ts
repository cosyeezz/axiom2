import { Emitter, Logger } from '@celljs/core';
import { UserState, UserStateManager } from './tips-protocol';
export declare class UserStateManagerImpl implements UserStateManager {
    protected readonly logger: Logger;
    protected readonly onDidChangeEmitter: Emitter<UserState>;
    readonly onDidChange: import("@celljs/core").Event<UserState>;
    private cachedState?;
    /**
     * server 面缺省 no-op（CODEBUDDY_DISABLE_USER_STATE=1）：消费者全是交互
     * 产品面（tips 展示冷却/启动计数），pod 上无消费者；写盘还会把多租户
     * 状态混进进程全局文件。no-op 而非内存假状态——假共享不如无共享
     * （local_storage 同判例）。
     */
    private get disabled();
    getState(): Promise<UserState>;
    setState(state: Partial<UserState>): Promise<void>;
    incrementStartup(): Promise<void>;
    updatePlanModeUse(): Promise<void>;
    incrementMemoryUsage(): Promise<void>;
    incrementPromptQueue(): Promise<void>;
    incrementSession(): Promise<void>;
    recordTipShown(tipId: string): Promise<void>;
    private getStateFilePath;
    private save;
}
