import { Logger } from '@genie/telemetry';
import { FileLockService } from '../lock';
/**
 * Task item structure - aligned with Claude Code TaskCreate/TaskUpdate tools
 */
export interface TaskItem {
    /** Unique task identifier */
    id: string;
    /** Brief title for the task (imperative form) */
    subject: string;
    /** Detailed description of what needs to be done */
    description: string;
    /** Present continuous form shown in spinner when in_progress */
    activeForm?: string;
    /** Task status */
    status: 'pending' | 'in_progress' | 'completed';
    /** Task owner (agent name) */
    owner?: string;
    /** Arbitrary metadata */
    metadata?: Record<string, unknown>;
    /** Task IDs that this task blocks (cannot start until this completes) */
    blocks?: string[];
    /** Task IDs that block this task (must complete before this can start) */
    blockedBy?: string[];
    /** Creation timestamp */
    createdAt: number;
    /** Last update timestamp */
    updatedAt: number;
}
/**
 * A stable TaskStorage snapshot used by the ACP v2 plan projector.
 *
 * `revision` is private transport state, not part of the ACP plan wire shape.
 * It lets a client channel reject an older concurrent tool result that arrives
 * after a newer replacing snapshot.
 */
export interface TaskStorageSnapshot {
    sourceId: string;
    revision: string;
    tasks: TaskItem[];
}
export declare const TaskStorageService: unique symbol;
/**
 * Interface for Task list persistence - aligned with Claude Code TaskCreate/TaskGet/TaskUpdate/TaskList
 */
export interface TaskStorageService {
    /**
     * Create a new task
     * @param sessionId The session ID
     * @param task The task to create (id will be auto-generated)
     * @returns The created task with assigned ID
     */
    create(sessionId: string, task: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskItem>;
    /**
     * Get a task by ID
     * @param sessionId The session ID
     * @param taskId The task ID
     * @returns The task or undefined if not found
     */
    get(sessionId: string, taskId: string): Promise<TaskItem | undefined>;
    /**
     * Update a task
     * @param sessionId The session ID
     * @param taskId The task ID
     * @param updates The fields to update
     * @returns The updated task or undefined if not found
     */
    update(sessionId: string, taskId: string, updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<TaskItem | undefined>;
    /**
     * Delete a task
     * @param sessionId The session ID
     * @param taskId The task ID
     * @returns true if deleted, false if not found
     */
    delete(sessionId: string, taskId: string): Promise<boolean>;
    /**
     * List all tasks
     * @param sessionId The session ID
     * @returns Array of all tasks
     */
    list(sessionId: string): Promise<TaskItem[]>;
    /**
     * Best-effort, strictly read a full snapshot under the storage lock and
     * assign it a private monotonic revision. Capture failure returns
     * undefined instead of changing the Task tool result.
     */
    listSnapshot(sessionId: string): Promise<TaskStorageSnapshot | undefined>;
    /**
     * Get the directory path for a session's tasks
     * @param sessionId The session ID
     */
    getTaskDir(sessionId: string): string;
}
export declare class TaskStorageServiceImpl implements TaskStorageService {
    protected readonly logger: Logger;
    protected readonly fileLockService: FileLockService;
    /**
     * Get the base directory for task storage
     */
    protected getTasksBaseDir(): string;
    /**
     * Get the directory path for a session's tasks
     */
    getTaskDir(sessionId: string): string;
    /**
     * Get the file path for a specific task
     */
    protected getTaskFilePath(sessionId: string, taskId: string): string;
    private getSnapshotRevisionFilePath;
    /**
     * Get the lock name for a session's tasks
     */
    protected getSessionLockName(sessionId: string): string;
    /**
     * Ensure the session's task directory exists
     */
    protected ensureTaskDir(sessionId: string): Promise<void>;
    /**
     * Get next available task ID by scanning existing files
     * Note: This must be called within a lock to prevent race conditions
     */
    protected getNextId(sessionId: string): Promise<number>;
    /**
     * Load a single task from file
     */
    protected loadTaskFile(sessionId: string, taskId: string): Promise<TaskItem | undefined>;
    /**
     * Save a single task to file using atomic write (write to temp, then rename)
     */
    protected saveTaskFile(sessionId: string, task: TaskItem): Promise<void>;
    /**
     * Delete a task file
     */
    protected deleteTaskFile(sessionId: string, taskId: string): Promise<boolean>;
    /**
     * Create a new task
     */
    create(sessionId: string, task: Omit<TaskItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<TaskItem>;
    /**
     * Get a task by ID
     */
    get(sessionId: string, taskId: string): Promise<TaskItem | undefined>;
    /**
     * Update a task
     */
    update(sessionId: string, taskId: string, updates: Partial<Omit<TaskItem, 'id' | 'createdAt'>>): Promise<TaskItem | undefined>;
    /**
     * Delete a task
     */
    delete(sessionId: string, taskId: string): Promise<boolean>;
    /**
     * List all tasks
     */
    list(sessionId: string): Promise<TaskItem[]>;
    listSnapshot(sessionId: string): Promise<TaskStorageSnapshot | undefined>;
    private readSnapshotRevision;
    private advanceSnapshotRevision;
    private listSnapshotUnlocked;
    private isTaskItem;
    private listUnlocked;
}
