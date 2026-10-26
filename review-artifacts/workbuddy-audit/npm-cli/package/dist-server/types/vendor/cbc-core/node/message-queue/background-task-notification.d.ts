import { type AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { BackgroundTask } from '../session/background-task-protocol';
export declare function consumeBackgroundTaskResult(task: BackgroundTask): void;
export declare function createBackgroundTaskNotification(task: BackgroundTask, text: string): AgentInputItem;
export declare function isConsumedBackgroundTaskNotification(item: string | AgentInputItem): boolean;
/** Preserve the process-local binding when a busy run copies its input into the queue. */
export declare function copyBackgroundTaskNotification(source: AgentInputItem, target: AgentInputItem): void;
//# sourceMappingURL=background-task-notification.d.ts.map