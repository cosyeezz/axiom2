import { Application, ApplicationLifecycle, Logger } from '@celljs/core';
import { FileVersionStore } from '@genie/cbc-checkpoint';
import { SessionHistoryCleanService, type SessionHistoryCleanupOptions, type SessionHistoryCleanupResult, SessionManager } from '../../vendor/cbc-core/node/index.js';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { SettingsManager } from '../settings';
export { ENV_KEY_CODEBUDDY_SESSION_HISTORY_CLEANUP, isSessionHistoryCleanupEnabled } from './session-history-clean-flag';
export declare class SessionHistoryCleanServiceImpl implements SessionHistoryCleanService, ApplicationLifecycle<Application> {
    protected readonly logger: Logger;
    protected readonly settingsManager: SettingsManager;
    protected readonly fileVersionStore: FileVersionStore;
    protected readonly sessionManager?: SessionManager;
    protected readonly prewarmState?: IPrewarmStateService;
    private cleanupInterval?;
    private startupTimeout?;
    initialize(): void;
    start(): Promise<void>;
    stop(): void;
    cleanup(): Promise<void>;
    cleanupLocalData(options?: SessionHistoryCleanupOptions): Promise<SessionHistoryCleanupResult>;
    private runCleanup;
    private createCleanupResult;
    private resolveExplicitDays;
    private resolveCleanupPeriodDays;
    private ensureStorageDir;
    private getSessionFilesRecursively;
    private getSessionMetaFilePath;
    private deleteExpiredSessionFile;
    private getSessionJsonlLayout;
    private isSessionJsonlInUse;
    private isLikelyMainSessionId;
    private isLikelySubagentSessionId;
    private cleanupSessionArtifactsForJsonl;
    private cleanupOrphanSessionArtifacts;
    private cleanupOrphanSubagentArtifactDirs;
    private cleanupOrphanSessionDir;
    private hasGeneratedChild;
    private cleanupGeneratedChildren;
    private cleanupOldPathRecursively;
    private pathExists;
    private removeEmptyDirectory;
    private isTraceCleanupCandidate;
    /**
     * Clean up expired trace files from all project directories.
     * Uses the same retention period as session history (cleanupPeriodDays).
     */
    private cleanupExpiredTraces;
    private cleanupSafeAuxiliaryPaths;
    private getCleanupPeriodDays;
}
