import { Session } from '../../vendor/cbc-core/node/index.js';
import { RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { TaskStorageService } from './task-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const TaskListParameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare class TaskListTool extends BaseTool implements Tool {
    protected readonly taskStorageService: TaskStorageService;
    protected readonly logger: Logger;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    readonly promptCacheStability: "volatile";
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(_input: z.infer<typeof TaskListParameters>, context?: RunContext<Session>): Promise<ToolResult>;
    private generateSummary;
}
export {};
