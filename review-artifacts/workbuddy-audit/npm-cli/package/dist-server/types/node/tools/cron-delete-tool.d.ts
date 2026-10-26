import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { CronDeleteSchema } from '@genie/cbc-cron';
import { Agent } from '../../vendor/cbc-shared/node/index.js';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
export declare class CronDeleteTool extends BaseTool implements Tool {
    private readonly stateManager;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        id: z.ZodString;
    }, "strict", z.ZodTypeAny, {
        id: string;
    }, {
        id: string;
    }>;
    strict: boolean;
    needsApproval: boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof CronDeleteSchema>, _context?: RunContext<Session>): Promise<ToolResult>;
}
