import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool } from './tool-protocol';
declare const BashOutputParameters: z.ZodObject<{
    shell_id: z.ZodString;
    filter: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    shell_id: string;
    filter?: string | undefined;
}, {
    shell_id: string;
    filter?: string | undefined;
}>;
export declare class BashOutputTool extends BaseTool implements Tool {
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    needsApproval: boolean;
    parameters: z.ZodObject<{
        shell_id: z.ZodString;
        filter: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        shell_id: string;
        filter?: string | undefined;
    }, {
        shell_id: string;
        filter?: string | undefined;
    }>;
    execute(input: z.infer<typeof BashOutputParameters>, context: RunContext<Session>): Promise<any>;
    private formatDuration;
}
export {};
