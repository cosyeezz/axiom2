import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { Agent } from '../agent';
import { Session } from '../session';
import { BaseTool } from './base-tool';
import { MemPlatformService } from './mem-platform-service';
import { Tool, ToolNames, ToolResult } from './tool-protocol';
declare const MemoryRecallParameters: z.ZodObject<{
    query: z.ZodString;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    query: string;
    reason?: string | undefined;
}, {
    query: string;
    reason?: string | undefined;
}>;
export declare class MemoryRecallTool extends BaseTool implements Tool {
    protected readonly memPlatformService: MemPlatformService;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        query: z.ZodString;
        reason: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        query: string;
        reason?: string | undefined;
    }, {
        query: string;
        reason?: string | undefined;
    }>;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(input: z.infer<typeof MemoryRecallParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
