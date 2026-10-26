import { Logger } from '@celljs/core';
import { InputHistoryItem, InputHistoryService } from '../../vendor/cbc-core/node/index.js';
import { LocalStorage } from '@genie/runtime';
import { WorkspaceFolderManager } from '../runtime';
export declare class InputHistoryServiceImpl implements InputHistoryService {
    protected readonly logger: Logger;
    protected readonly workspaceFolderManager: WorkspaceFolderManager;
    protected readonly localStorage: LocalStorage;
    private writeLock;
    private readonly maxHistorySize;
    private readonly localStorageKey;
    private cleanupTimer;
    private readonly cleanupDelay;
    private lastHistoryItem;
    /**
     * Get the history file path
     */
    private getHistoryFilePath;
    /**
     * Read the history file
     */
    private readHistoryFile;
    /**
     * Write the history file
     */
    private writeHistoryFile;
    /**
     * Get legacy history from localStorage (compatibility support)
     */
    private getLegacyHistoryFromLocalStorage;
    /**
     * Incrementally append history item to the end of file
     */
    private appendHistoryItem;
    /**
     * Schedule cleanup task (debounced)
     */
    private scheduleCleanup;
    /**
     * Periodically clean up excess history records
     * This method first quickly checks file size and only performs cleanup when necessary
     */
    private cleanupExcessHistory;
    addHistory(item: Omit<InputHistoryItem, 'timestamp' | 'project'>): Promise<void>;
    getHistoryForProject(limit?: number): Promise<InputHistoryItem[]>;
    cleanupHistory(olderThanDays?: number): Promise<void>;
}
