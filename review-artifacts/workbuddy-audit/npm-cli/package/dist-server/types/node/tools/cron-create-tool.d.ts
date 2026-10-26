import { Session } from '../../vendor/cbc-core/node/index.js';
import { CronCreateFullSchema } from '@genie/cbc-cron';
import { Agent, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
export declare class CronCreateTool extends BaseTool implements Tool {
    private readonly stateManager;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        cron: z.ZodString;
        prompt: z.ZodString;
        recurring: z.ZodOptional<z.ZodBoolean>;
        agentId: z.ZodOptional<z.ZodString>;
        expiryDays: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        durable: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        prompt: string;
        cron: string;
        agentId?: string | undefined;
        recurring?: boolean | undefined;
        expiryDays?: number | null | undefined;
        durable?: boolean | undefined;
    }, {
        prompt: string;
        cron: string;
        agentId?: string | undefined;
        recurring?: boolean | undefined;
        expiryDays?: number | null | undefined;
        durable?: boolean | undefined;
    }>;
    strict: boolean;
    /**
     * Session-only 任务随会话消亡、副作用可控，无需授权。durable 任务会写盘并在
     * 无人值守的任务会话里反复执行，属于持久化副作用，每次创建都必须过一次审批。
     */
    needsApproval: (_runContext: RunContext<Session>, input: z.infer<typeof CronCreateFullSchema>) => Promise<boolean>;
    argumentRenderer: ToolCallArgumentRenderer;
    isEnabled: (_args: {
        runContext: RunContext<Session>;
        agent: Agent;
    }) => Promise<boolean>;
    /**
     * Auto mode classifier projection: `${cron}: ${prompt}` (Claude alignment,
     * decision D1) — a scheduled/delayed-execution action; the prompt is the
     * deferred risk. Consumed in history (CronCreate has `needsApproval = false`).
     */
    toAutoClassifierInput(input: unknown): string;
    execute(input: z.infer<typeof CronCreateFullSchema>, _context?: RunContext<Session>): Promise<ToolResult>;
}
