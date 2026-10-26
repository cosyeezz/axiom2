import type { NotificationType } from '../../../cbc-shared/node/index.js';
import type { Session } from './session-protocol';
export declare const SessionHookHost: unique symbol;
export interface SessionHookHost {
    readonly notificationTitle: string;
    getWorkDir(): string;
    sendNotification(message: string, notificationType: NotificationType | undefined, session: Session | undefined): Promise<void>;
    /** onChange 返回的 Promise 会被等待，用于对批量文件变更做背压。 */
    registerWatchPaths(paths: unknown, onChange: (path: string, event: 'change' | 'add' | 'unlink') => void | Promise<void>): {
        watcherCount: number;
        dispose(): void;
    };
}
//# sourceMappingURL=session-hook-host-protocol.d.ts.map