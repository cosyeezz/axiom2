import { Logger } from '@genie/telemetry';
import { NotificationType } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { SettingsManager } from '../settings/settings-protocol';
import { TerminalNotificationService } from './notification-protocol';
/**
 * 终端通知服务实现
 *
 * 负责发送终端通知，使用现代终端支持的 OSC 协议
 * 支持用户自定义首选通知渠道，或自动选择最佳协议
 */
export declare class TerminalNotificationServiceImpl implements TerminalNotificationService {
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    sendNotification(message: string, title?: string, notificationType?: NotificationType, session?: Session): Promise<void>;
    /**
     * Tool-triggered notification (model calling PushNotificationTool).
     * Bypasses the hooks-only NotificationType whitelist that sendNotification applies —
     * a tool call is an explicit, deliberate request to notify the user.
     */
    sendToolNotification(message: string, title?: string, session?: Session): Promise<void>;
    /**
     * Select/generate the OSC sequence for the preferred channel, wrap for tmux if needed,
     * and write it to the terminal. Caller is responsible for the try/catch + BEL fallback;
     * settingsManager.get() failures must also degrade to BEL.
     */
    private dispatchOsc;
    /** Best-effort BEL fallback, swallows its own errors (last resort, nothing left to fall back to). */
    private fallbackToBel;
    /**
     * 根据用户指定的通知渠道生成 OSC 序列
     */
    private generateNotificationByChannel;
    private shouldSendNotification;
}
