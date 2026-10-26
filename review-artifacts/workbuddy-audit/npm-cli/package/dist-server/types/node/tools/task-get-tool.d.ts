import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { TaskStorageService } from './task-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const TaskGetParameters: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare class TaskGetTool extends BaseTool implements Tool {
    protected readonly taskStorageService: TaskStorageService;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    parameters: z.ZodObject<{
        taskId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        taskId: string;
    }, {
        taskId: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof TaskGetParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
export {};
