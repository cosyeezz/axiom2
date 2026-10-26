import { NotificationType } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ProgressState } from '../utils/osc-protocol-utils';
export declare const TerminalNotificationService: unique symbol;
export interface TerminalNotificationService {
    sendNotification(message: string, title?: string, notificationType?: NotificationType, session?: Session): Promise<void>;
    /**
     * Tool-triggered notification (model calling PushNotificationTool).
     * Bypasses the hooks-only NotificationType whitelist in sendNotification.
     */
    sendToolNotification(message: string, title?: string, session?: Session): Promise<void>;
}
export declare const ProgressSyncService: unique symbol;
export interface ProgressSyncService {
    start(session: Session): Promise<void>;
    stop(sessionId: string): void;
    updateProgress(state: ProgressState, percentage?: number): void;
    clearProgress(): void;
}
