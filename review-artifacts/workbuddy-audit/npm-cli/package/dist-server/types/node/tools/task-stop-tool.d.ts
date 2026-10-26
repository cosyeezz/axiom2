import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentTaskManager } from '../agent-task/agent-task-protocol';
import { InterruptionService, Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const TaskStopParameters: z.ZodEffects<z.ZodObject<{
    task_id: z.ZodOptional<z.ZodString>;
    shell_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    task_id?: string | undefined;
    shell_id?: string | undefined;
}, {
    task_id?: string | undefined;
    shell_id?: string | undefined;
}>, {
    task_id?: string | undefined;
    shell_id?: string | undefined;
}, {
    task_id?: string | undefined;
    shell_id?: string | undefined;
}>;
export declare class TaskStopTool extends BaseTool implements Tool {
    protected readonly agentTaskManager: AgentTaskManager;
    protected readonly interruptionService: InterruptionService;
    name: ToolNames;
    description: string;
    aliases: string[];
    parameters: z.ZodEffects<z.ZodObject<{
        task_id: z.ZodOptional<z.ZodString>;
        shell_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        task_id?: string | undefined;
        shell_id?: string | undefined;
    }, {
        task_id?: string | undefined;
        shell_id?: string | undefined;
    }>, {
        task_id?: string | undefined;
        shell_id?: string | undefined;
    }, {
        task_id?: string | undefined;
        shell_id?: string | undefined;
    }>;
    needsApproval: boolean;
    /** Auto mode classifier projection: the target task/shell id (Claude alignment, decision D1). */
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof TaskStopParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * Stop an agent sub-task via AgentTaskManager
     */
    private stopAgentTask;
    /**
     * Stop a background shell task via ToolManager
     */
    private stopBackgroundShellTask;
    private currentMainSessionId;
    private formatDuration;
}
export {};
