import { type BackgroundTask } from '../../vendor/cbc-core/node/index.js';
import type { ToolManager } from '../tools/tool-protocol';
export interface BackgroundTaskResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    output?: string;
}
interface TaskInfo {
    taskId: string;
    createdAt: string;
    lastUpdatedAt: string;
    /** Lifetime from createdAt in milliseconds, not from lastUpdatedAt; null while active. */
    ttlMs: number | null;
    pollIntervalMs: number;
    _meta: {
        'codebuddy.ai': {
            title: string;
            toolName: string;
            toolCallId?: string;
        };
    };
}
/** ACP task snapshot. This is a projection of the existing background registry. */
export type BackgroundTaskSnapshot = TaskInfo & ({
    status: 'working';
} | {
    status: 'completed';
    result: BackgroundTaskResult;
} | {
    status: 'failed';
    error: {
        code: number;
        message: string;
        data: BackgroundTaskResult;
    };
} | {
    status: 'cancelled';
});
/** Only shell producers currently provide the output and terminal lifecycle required by this contract. */
export declare function ownedBackgroundTasks(manager: Pick<ToolManager, 'getBackgroundTasks'>, sessionId: string): Array<BackgroundTask & {
    terminalId: string;
}>;
export declare function backgroundTaskSnapshot(task: BackgroundTask & {
    terminalId: string;
}): BackgroundTaskSnapshot;
export {};
