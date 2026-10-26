import { Logger } from '@genie/telemetry';
import { TodoToolItem } from './tool-protocol';
export declare const TodoStorageService: unique symbol;
/**
 * Interface for Todo list persistence
 */
export interface TodoStorageService {
    /**
     * Save todo list for a session
     * @param sessionId The session ID
     * @param todos The todo items to save
     */
    save(sessionId: string, todos: TodoToolItem[]): Promise<void>;
    /**
     * Load todo list for a session
     * @param sessionId The session ID
     * @returns The todo items or undefined if not found
     */
    load(sessionId: string): Promise<TodoToolItem[] | undefined>;
    /**
     * Get the file path for a session's todo list
     * @param sessionId The session ID
     */
    getTodoFilePath(sessionId: string): string;
}
export declare class TodoStorageServiceImpl implements TodoStorageService {
    protected readonly logger: Logger;
    /**
     * Get the base directory for todo storage
     */
    protected getTodosDir(): string;
    /**
     * Get the file path for a session's todo list
     */
    getTodoFilePath(sessionId: string): string;
    /**
     * Ensure the todos directory exists
     */
    protected ensureTodosDir(): Promise<void>;
    /**
     * Save todo list for a session
     */
    save(sessionId: string, todos: TodoToolItem[]): Promise<void>;
    /**
     * Load todo list for a session
     */
    load(sessionId: string): Promise<TodoToolItem[] | undefined>;
}
