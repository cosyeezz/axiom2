import { isMultitaskCoordinator } from './session-flags';
/** TaskStop / InterruptAgent 在 cancel 前打标：协调器已经看过 ToolResult，不要再 wakeup。 */
export declare function markCoordinatorSelfStop(task: {
    id?: string;
    sessionId?: string;
    resume?: unknown;
}): void;
/** 只有协调器自己停 worker 才打标。Esc / UI 停不走这里，照常 wakeup。 */
export declare function markCoordinatorSelfStopIfNeeded(session: Parameters<typeof isMultitaskCoordinator>[0], task: {
    id?: string;
    sessionId?: string;
    resume?: unknown;
}): void;
/** 终态消费一次。命中则跳过 `<task-notification>`，锁仍由 CompletionBus 清。 */
export declare function takeCoordinatorSelfStop(task: {
    id?: string;
    sessionId?: string;
    resume?: unknown;
}): boolean;
/** @internal */
export declare function resetCoordinatorSelfStopForTests(): void;
