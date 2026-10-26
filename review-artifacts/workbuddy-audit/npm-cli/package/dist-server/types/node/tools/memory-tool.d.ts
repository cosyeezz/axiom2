import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { MemoryManager } from '../memory';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const MemoryParameters: z.ZodObject<{
    fact: z.ZodString;
    scope: z.ZodEnum<["user", "project", "project_local"]>;
}, "strip", z.ZodTypeAny, {
    scope: "user" | "project" | "project_local";
    fact: string;
}, {
    scope: "user" | "project" | "project_local";
    fact: string;
}>;
export declare class MemoryTool extends BaseTool implements Tool {
    protected readonly memoryManager: MemoryManager;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        fact: z.ZodString;
        scope: z.ZodEnum<["user", "project", "project_local"]>;
    }, "strip", z.ZodTypeAny, {
        scope: "user" | "project" | "project_local";
        fact: string;
    }, {
        scope: "user" | "project" | "project_local";
        fact: string;
    }>;
    execute(input: z.infer<typeof MemoryParameters>, context?: RunContext): Promise<ToolResult>;
}
export {};
