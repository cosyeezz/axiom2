import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { TaskStorageService } from './task-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const TaskUpdateParameters: z.ZodObject<{
    taskId: z.ZodString;
    subject: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    activeForm: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<["pending", "in_progress", "completed", "deleted"]>>;
    addBlocks: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    addBlockedBy: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    owner: z.ZodOptional<z.ZodString>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    description?: string | undefined;
    status?: "pending" | "in_progress" | "completed" | "deleted" | undefined;
    owner?: string | undefined;
    subject?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    activeForm?: string | undefined;
    addBlocks?: string[] | undefined;
    addBlockedBy?: string[] | undefined;
}, {
    taskId: string;
    description?: string | undefined;
    status?: "pending" | "in_progress" | "completed" | "deleted" | undefined;
    owner?: string | undefined;
    subject?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
    activeForm?: string | undefined;
    addBlocks?: string[] | undefined;
    addBlockedBy?: string[] | undefined;
}>;
export declare class TaskUpdateTool extends BaseTool implements Tool {
    protected readonly taskStorageService: TaskStorageService;
    protected readonly logger: Logger;
    name: ToolNames;
    parameters: z.ZodObject<{
        taskId: z.ZodString;
        subject: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        activeForm: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<["pending", "in_progress", "completed", "deleted"]>>;
        addBlocks: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        addBlockedBy: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        owner: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
        description?: string | undefined;
        status?: "pending" | "in_progress" | "completed" | "deleted" | undefined;
        owner?: string | undefined;
        subject?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        activeForm?: string | undefined;
        addBlocks?: string[] | undefined;
        addBlockedBy?: string[] | undefined;
    }, {
        taskId: string;
        description?: string | undefined;
        status?: "pending" | "in_progress" | "completed" | "deleted" | undefined;
        owner?: string | undefined;
        subject?: string | undefined;
        metadata?: Record<string, unknown> | undefined;
        activeForm?: string | undefined;
        addBlocks?: string[] | undefined;
        addBlockedBy?: string[] | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof TaskUpdateParameters>, context?: RunContext<Session>): Promise<ToolResult>;
    private buildCompletionGuidance;
}
export {};
