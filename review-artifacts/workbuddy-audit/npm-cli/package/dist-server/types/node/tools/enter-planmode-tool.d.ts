import { Logger } from '@celljs/core';
import { PromptManager } from '@genie/prompts';
import { Workspace } from '@genie/runtime';
import { EventService } from '@genie/telemetry';
import { z } from 'zod';
import { AgentInputItem, RunContext } from '../../vendor/cbc-shared/node/index.js';
import { ShellService } from '../shell';
import { BaseTool } from './base-tool';
import { PlanStorageService } from './plan-storage-service';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const EnterPlanModeParameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare class EnterPlanModeTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly shellService: ShellService;
    protected readonly promptManager: PromptManager;
    protected readonly planStorageService: PlanStorageService;
    protected readonly eventService: EventService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    execute(input: z.infer<typeof EnterPlanModeParameters>, context?: RunContext): Promise<ToolResult>;
    private reportPlanAction;
    resolveRejectedResult(rawItem: AgentInputItem): Promise<AgentInputItem[]>;
}
export {};
