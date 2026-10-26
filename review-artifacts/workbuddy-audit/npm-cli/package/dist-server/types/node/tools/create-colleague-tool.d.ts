/**
 * CreateColleague —— agent 自主建同事（自治组队第一步）。
 *
 * 建的是 `~/.codebuddy/agent-home/directory.json` 里的 AgentHomeProfile：
 * 没有 job，等有人 @ / 派任务时才被唤醒起 job。
 * 规则（配额 / 深度 / 频率）全在 agent-home-agent-create，工具只做映射。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolNames, ToolResult } from './tool-protocol';
export declare class CreateColleagueTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        name: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        engine: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        permissionMode: z.ZodOptional<z.ZodString>;
        homeCwd: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        description?: string | undefined;
        title?: string | undefined;
        model?: string | undefined;
        permissionMode?: string | undefined;
        engine?: string | undefined;
        homeCwd?: string | undefined;
    }, {
        name: string;
        description?: string | undefined;
        title?: string | undefined;
        model?: string | undefined;
        permissionMode?: string | undefined;
        engine?: string | undefined;
        homeCwd?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    toAutoClassifierInput(_input: unknown): string;
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    execute(input: {
        name?: string;
        title?: string;
        description?: string;
        engine?: string;
        model?: string;
        permissionMode?: string;
        homeCwd?: string;
    }, context?: RunContext<Session>): Promise<ToolResult>;
}
