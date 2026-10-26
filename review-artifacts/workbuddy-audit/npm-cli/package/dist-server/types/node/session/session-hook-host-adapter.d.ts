import { CoreHookExecutor, type HookInput, type InternalHookContext, type Session, SessionHookHost } from '../../vendor/cbc-core/node/index.js';
import type { HookEvent, HookExecutionOptions, HookExecutionResult, NotificationType } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { HookManager } from '../hooks/hook-protocol';
import { TerminalNotificationService } from '../notification/notification-protocol';
export declare class CoreHookExecutorAdapter implements CoreHookExecutor {
    protected readonly hooks: HookManager;
    executeHooks(event: HookEvent, input: HookInput, options?: HookExecutionOptions, internalContext?: InternalHookContext): Promise<HookExecutionResult>;
    hasHooks(event: HookEvent, toolName?: string): Promise<boolean>;
}
export declare class SessionHookHostAdapter implements SessionHookHost {
    readonly notificationTitle: string;
    protected readonly logger: Logger;
    protected readonly notifications: TerminalNotificationService;
    getWorkDir(): string;
    sendNotification(message: string, type: NotificationType | undefined, session: Session | undefined): Promise<void>;
    registerWatchPaths(paths: unknown, onChange: (path: string, event: 'change' | 'add' | 'unlink') => void | Promise<void>): {
        watcherCount: number;
        dispose(): void;
    };
}
