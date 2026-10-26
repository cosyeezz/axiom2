import { AgentManager, PromptRenderer, Session } from '../../vendor/cbc-core/node/index.js';
import { type FunctionCallItem, ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { ProductManager } from '@genie/product';
import { EventService, Logger } from '@genie/telemetry';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { AgentTaskManager } from '../agent-task/agent-task-protocol';
import { CommandManager, CustomCommandRenderer } from '../command';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const SkillParameters: z.ZodEffects<z.ZodObject<{
    skill: z.ZodOptional<z.ZodString>;
    command: z.ZodOptional<z.ZodString>;
    args: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    command?: string | undefined;
    skill?: string | undefined;
    args?: string | undefined;
}, {
    command?: string | undefined;
    skill?: string | undefined;
    args?: string | undefined;
}>, {
    command?: string | undefined;
    skill?: string | undefined;
    args?: string | undefined;
}, {
    command?: string | undefined;
    skill?: string | undefined;
    args?: string | undefined;
}>;
export declare class SkillTool extends BaseTool implements Tool {
    protected readonly productManager: ProductManager;
    protected readonly customCommandRenderer: CustomCommandRenderer;
    protected readonly promptRenderer: PromptRenderer;
    protected readonly logger: Logger;
    protected readonly taskManager: AgentTaskManager;
    protected readonly commandManager: CommandManager;
    protected readonly agentManager: AgentManager;
    protected readonly eventService: EventService;
    protected readonly settingsManager: SettingsManager;
    private readonly disabledCallsBySession;
    name: ToolNames;
    readonly promptCacheStability: "volatile";
    aliases: string[];
    parameters: z.ZodEffects<z.ZodObject<{
        skill: z.ZodOptional<z.ZodString>;
        command: z.ZodOptional<z.ZodString>;
        args: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        command?: string | undefined;
        skill?: string | undefined;
        args?: string | undefined;
    }, {
        command?: string | undefined;
        skill?: string | undefined;
        args?: string | undefined;
    }>, {
        command?: string | undefined;
        skill?: string | undefined;
        args?: string | undefined;
    }, {
        command?: string | undefined;
        skill?: string | undefined;
        args?: string | undefined;
    }>;
    needsApproval: (runContext: RunContext<Session>, input: unknown, callId?: string) => Promise<boolean>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof SkillParameters>, callId?: string): ToolArg[];
    execute(input: z.infer<typeof SkillParameters>, context: RunContext<Session>, details?: {
        toolCall: FunctionCallItem;
    }): Promise<ToolResult>;
    /**
     * Execute a slash command (from commands configuration or built-in commands)
     */
    private executeSlashCommand;
    /**
     * Try to execute a built-in command. Returns null if not a built-in command.
     */
    private tryExecuteBuiltinCommand;
    /**
     * Find a skill by name, supporting exact match, short name match, and displayName fallback.
     * For short names (without ':'), if multiple skills share the same short name,
     * returns undefined and sets an ambiguity error message.
     *
     * 同名技能里被 skillOverrides 关掉的那份不遮挡其余同名技能；只剩关掉的那份时仍命中它，
     * 由调用方返回禁用文案。
     */
    private findSkill;
    /**
     * Execute a skill (from skills configuration)
     * If skill not found, try to find as slash command
     */
    private executeSkill;
    protected safeRender(promptToRender: string): Promise<string>;
    /**
     * 上报插件 skill 能力调用埋点。
     * 仅当 skill 带 pluginInfo 时触发。
     * 仅在 WorkBuddy Desktop 宿主下上报；其他宿主（VSCode 插件、纯 CLI 等）各自有独立的上报链路。
     */
    private reportPluginCapabilityCall;
    /**
     * 上报插件 command 能力调用埋点。
     * 插件 command 的 tags 形如 [CUSTOM_COMMAND_TAG, PLUGIN_TAG, source]，
     * 其中 source 形如 "pluginName@marketplaceName"。
     * 仅在 WorkBuddy Desktop 宿主下上报。
     */
    private reportPluginCommandCall;
    private rememberDisabledCall;
    private consumeDisabledCall;
    private validateToolParams;
    /**
     * Execute skill in fork context (isolated subagent)
     * The subagent runs independently without access to main conversation history,
     * but will load CODEBUDDY.md through the session mechanism.
     *
     * Aligns with Claude Code's fork context execution:
     * - Skill content becomes the prompt (via buildForkPrompt)
     * - No conversation history is inherited
     */
    private executeSkillInForkContext;
    /**
     * Build prompt for fork context execution
     * Aligns with Claude Code's Q06 function behavior:
     * - Uses getPromptForCommand pattern (Base directory prefix + skill content)
     * - Processes content through the standard pipeline: $ARGUMENTS → !`command` → @file references
     * - Does NOT add extra "You are executing skill" prefix
     */
    private buildForkPrompt;
}
export {};
