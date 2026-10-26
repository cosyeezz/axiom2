import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const KillShellParameters: z.ZodObject<{
    shell_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    shell_id: string;
}, {
    shell_id: string;
}>;
export declare class KillShellTool extends BaseTool implements Tool {
    name: ToolNames;
    aliases: string[];
    parameters: z.ZodObject<{
        shell_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        shell_id: string;
    }, {
        shell_id: string;
    }>;
    execute(input: z.infer<typeof KillShellParameters>, context: RunContext<Session>): Promise<any>;
    private formatDuration;
}
export {};
