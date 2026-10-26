import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { type AgentTask, type AgentTaskExecutionConfig } from './agent-task-protocol';
export declare const AGENT_TREE_GRACE_MS = 30000;
export declare function onRetainedAgentTasksChanged(listener: () => void): () => void;
export declare function dismissRetainedAgentTask(taskId: string): void;
export declare function startRetainedAgentTask(config: AgentTaskExecutionConfig): AgentTask;
/** Observe TUI agent invocations without retaining them before the user opens Agent view. */
export declare function trackInteractiveAgentTask(task: AgentTask, notify?: boolean): void;
export declare function setRetainedAgentTaskFocused(taskId: string, focused: boolean): void;
export declare function sendToRetainedAgentTask(taskId: string, message: string | AgentInputItem[], parentSession: Session): Promise<string>;
