/**
 * SpeakInChannel —— 往频道 jsonl 说话。
 * 不是 MessageColleague，不写对方 1:1，不进 jobAssignments。
 * 落盘走带锁的 applyChannelSpeech；成功后叫醒其他成员，不叫醒自己。
 *
 * 频道解析走 agent-home-channel-context，叫醒走 ChannelWakeService——
 * 工具里不再出现 ContainerUtil.get / 目录读写的样板。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { ChannelWakeService } from '../agent-home/channel-wake-service';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const SpeakInChannelParameters: z.ZodObject<{
    content: z.ZodOptional<z.ZodString>;
    channel: z.ZodOptional<z.ZodString>;
    mentions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    replyTo: z.ZodOptional<z.ZodString>;
    attachments: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    widget: z.ZodOptional<z.ZodObject<{
        prompt: z.ZodString;
        helpText: z.ZodOptional<z.ZodString>;
        options: z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            value: z.ZodOptional<z.ZodString>;
            style: z.ZodOptional<z.ZodEnum<["default", "primary", "danger"]>>;
        }, "strip", z.ZodTypeAny, {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }, {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        prompt: string;
        options: {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }[];
        helpText?: string | undefined;
    }, {
        prompt: string;
        options: {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }[];
        helpText?: string | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    content?: string | undefined;
    mentions?: string[] | undefined;
    attachments?: string[] | undefined;
    channel?: string | undefined;
    widget?: {
        prompt: string;
        options: {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }[];
        helpText?: string | undefined;
    } | undefined;
    replyTo?: string | undefined;
}, {
    content?: string | undefined;
    mentions?: string[] | undefined;
    attachments?: string[] | undefined;
    channel?: string | undefined;
    widget?: {
        prompt: string;
        options: {
            label: string;
            value?: string | undefined;
            style?: "default" | "primary" | "danger" | undefined;
        }[];
        helpText?: string | undefined;
    } | undefined;
    replyTo?: string | undefined;
}>;
type SpeakInChannelInput = z.infer<typeof SpeakInChannelParameters>;
export declare class SpeakInChannelTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly wakeService?: ChannelWakeService;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        content: z.ZodOptional<z.ZodString>;
        channel: z.ZodOptional<z.ZodString>;
        mentions: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        replyTo: z.ZodOptional<z.ZodString>;
        attachments: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        widget: z.ZodOptional<z.ZodObject<{
            prompt: z.ZodString;
            helpText: z.ZodOptional<z.ZodString>;
            options: z.ZodArray<z.ZodObject<{
                label: z.ZodString;
                value: z.ZodOptional<z.ZodString>;
                style: z.ZodOptional<z.ZodEnum<["default", "primary", "danger"]>>;
            }, "strip", z.ZodTypeAny, {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }, {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }>, "many">;
        }, "strip", z.ZodTypeAny, {
            prompt: string;
            options: {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }[];
            helpText?: string | undefined;
        }, {
            prompt: string;
            options: {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }[];
            helpText?: string | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        content?: string | undefined;
        mentions?: string[] | undefined;
        attachments?: string[] | undefined;
        channel?: string | undefined;
        widget?: {
            prompt: string;
            options: {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }[];
            helpText?: string | undefined;
        } | undefined;
        replyTo?: string | undefined;
    }, {
        content?: string | undefined;
        mentions?: string[] | undefined;
        attachments?: string[] | undefined;
        channel?: string | undefined;
        widget?: {
            prompt: string;
            options: {
                label: string;
                value?: string | undefined;
                style?: "default" | "primary" | "danger" | undefined;
            }[];
            helpText?: string | undefined;
        } | undefined;
        replyTo?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    toAutoClassifierInput(_input: unknown): string;
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    /**
     * 有身份即可说话：默认 Agent 或已认领/已登记的同事（设置闸门走 agentHomeRoomToolRefusal）。
     * **只管可见性**：缺省解析（未认领 job 回落默认 Agent）意味着"工具在"；能不能真的说，
     * 由 execute 的 strict 解析与 applyChannelSpeech 的 INVALID_SPEAKER 决定（#125667 评审）。
     */
    private hasChannelIdentity;
    execute(input: SpeakInChannelInput, context?: RunContext<Session>): Promise<ToolResult>;
}
export {};
