import type { TaskItem } from './task-storage-service';
import { type TodoToolItem } from './tool-protocol';
/**
 * Convert TaskItem array to TodoToolItem array for UI display
 */
export declare function tasksToTodos(tasks: TaskItem[]): TodoToolItem[];
