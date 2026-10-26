import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { Agent } from '../agent';
import { Session } from '../session';
import { BaseTool } from './base-tool';
import { MemPlatformService } from './mem-platform-service';
import { Tool, ToolNames, ToolResult } from './tool-protocol';
declare const MemoryUpdateParameters: z.ZodObject<{
    content: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    content: string;
    reason?: string | undefined;
}, {
    content: string;
    reason?: string | undefined;
}>;
export declare class MemoryUpdateTool extends BaseTool implements Tool {
    protected readonly memPlatformService: MemPlatformService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        content: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        content: string;
        reason?: string | undefined;
    }, {
        content: string;
        reason?: string | undefined;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof MemoryUpdateParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
