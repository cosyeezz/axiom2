/**
 * In-Process Teammate Backend
 *
 * 默认后端——teammate 在同一 Node.js 进程内通过 AgentTask 运行，
 * 使用 AsyncLocalStorage 隔离 session 上下文。
 *
 * 这是对 TeamMember.spawn() 中原有 AgentTask 创建逻辑的提取，
 * 行为完全向后兼容。
 */
import type { ITeammateBackend, TeammateSpawnConfig, TeammateSpawnResult } from './teammate-backend-protocol';
export declare class InProcessTeammateBackend implements ITeammateBackend {
    readonly type: "in-process";
    private readonly tasks;
    isAvailable(): Promise<boolean>;
    spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>;
    /**
     * Start a fresh physical turn for an existing logical teammate while
     * resuming its stable AgentTask transcript. This intentionally lives only
     * on the concrete in-process backend: process/pane based backends have a
     * different lifecycle and are not required to implement this operation.
     */
    resume(config: TeammateSpawnConfig, resumeSessionId: string): Promise<TeammateSpawnResult>;
    private startTask;
    /**
     * Build a BackgroundTask adapter that mirrors the AgentTask lifecycle and
     * push it onto the main session's `backgroundTaskSubject` + ToolManager, so
     * StreamJsonView emits task_started / task_progress / task_updated /
     * task_notification for background sub-agents (task_type='Agent').
     *
     * The adapter shares the AgentTask's `id`, so TaskOutput still resolves the
     * task via AgentTaskManager first (unchanged behavior); the ToolManager copy
     * is only consumed by StreamJsonView catch-up and the Stop-hook context.
     */
    private bridgeToBackgroundTaskStream;
    waitForSettlement(backendId: string): Promise<void>;
    kill(backendId: string): Promise<boolean>;
    isAlive(backendId: string): Promise<boolean>;
}
