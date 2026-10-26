import { Session } from '../../vendor/cbc-core/node/index.js';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/** Max prompt length shown in a CronList line before truncating with an ellipsis. */
export declare const CRON_LIST_PROMPT_PREVIEW_LENGTH = 80;
/**
 * Truncate a job's prompt to the preview length shown in CronList output.
 * Anything relying on this preview being visible (e.g. the /loop marker
 * lookup in loop-skill-provider.ts) must stay within this length.
 */
export declare function truncatePromptPreview(prompt: string): string;
export declare class CronListTool extends BaseTool implements Tool {
    private readonly stateManager;
    name: ToolNames;
    description: string;
    parameters: import("zod").ZodObject<{}, "strict", import("zod").ZodTypeAny, {}, {}>;
    strict: boolean;
    needsApproval: boolean;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    execute(_input?: unknown, _context?: RunContext<Session>): Promise<ToolResult>;
}
