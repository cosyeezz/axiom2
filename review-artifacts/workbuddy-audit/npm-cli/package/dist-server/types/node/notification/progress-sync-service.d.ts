import { Logger } from '@genie/telemetry';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ProgressState } from '../utils/osc-protocol-utils';
import { ProgressSyncService } from './notification-protocol';
import { SettingsManager } from '../settings/settings-protocol';
/**
 * 进度同步服务实现
 *
 * 负责将会话进度状态同步到终端，使用 OSC 9;4 或 OSC 99 协议
 * 支持的终端会在窗口/标签页上显示进度指示器
 */
export declare class ProgressSyncServiceImpl implements ProgressSyncService {
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    private subscriptions;
    private lastProgressUpdate;
    private readonly PROGRESS_UPDATE_INTERVAL;
    private currentProgressState?;
    start(session: Session): Promise<void>;
    stop(sessionId: string): void;
    updateProgress(state: ProgressState, percentage?: number): void;
    clearProgress(): void;
}
