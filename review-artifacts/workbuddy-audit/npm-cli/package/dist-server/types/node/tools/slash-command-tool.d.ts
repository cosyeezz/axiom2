import { PromptRenderer, Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { CommandManager, CustomCommandRenderer } from '../command';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const SlashCommandParameters: z.ZodObject<{
    command: z.ZodString;
}, "strip", z.ZodTypeAny, {
    command: string;
}, {
    command: string;
}>;
export declare class SlashCommandTool extends BaseTool implements Tool {
    protected readonly productManager: ProductManager;
    protected readonly customCommandRenderer: CustomCommandRenderer;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly commandManager: CommandManager;
    protected readonly logger: Logger;
    name: ToolNames;
    readonly promptCacheStability: "volatile";
    aliases: string[];
    parameters: z.ZodObject<{
        command: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        command: string;
    }, {
        command: string;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: (runContext: RunContext<Session>, input: z.infer<typeof SlashCommandParameters>, callId?: string) => Promise<boolean>;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof SlashCommandParameters>, callId?: string): ToolArg[];
    execute(input: z.infer<typeof SlashCommandParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * Execute a built-in command via CommandManager.
     */
    protected executeBuiltinCommand(trimmedCommand: string, commandName: string, context: RunContext<Session>): Promise<ToolResult>;
    protected safeRender(promptToRender: string): Promise<string>;
    /**
     * Bridge a slash command to the mods runtime — thin adapter over
     * {@link dispatchModCommand}. See that helper's jsdoc for the routing
     * contract (`{ text }` / `{ deny }` return; empty `{}` falls through).
     */
    private tryModsRuntimeCommand;
    private extractCommandName;
    private validateToolParams;
}
export {};
