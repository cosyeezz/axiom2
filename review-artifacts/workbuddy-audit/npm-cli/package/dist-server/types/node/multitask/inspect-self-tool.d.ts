import type { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from '../tools/base-tool';
import { Tool, type ToolResult } from '../tools/tool-protocol';
import type { SelfSnapshot } from './types';
declare const InspectSelfParameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
/** TUI 折叠行：不把整份 JSON 摊开。tools[] / notes 只留在 content 给模型。 */
export declare function formatInspectSelfTitle(snap: SelfSnapshot): string;
export declare class InspectSelfTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    needsApproval: boolean;
    execute(_input: z.infer<typeof InspectSelfParameters>, context?: RunContext<Session>): Promise<ToolResult>;
}
export {};
