/**
 * CreateChannel —— agent 自主建频道 / 拉人（自治组队第二步）。
 *
 * create：2–6 个常驻同事（主 Agent 不是成员，不算名额），lead 缺省创建者（同事）否则第一个成员；给了 kickoff 就作为第一句发言并
 *   全员唤醒（没有 job 的同事会当场起 job）。invite：把已有同事加进来，
 *   同样可选 kickoff 唤醒。
 * 规则（成员解析 / 配额 / lead）全在 agent-home-channel-create，工具只做编排。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { ChannelWakeService } from '../agent-home/channel-wake-service';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolNames, ToolResult } from './tool-protocol';
declare const CreateChannelParameters: z.ZodObject<{
    action: z.ZodEnum<["create", "invite"]>;
    name: z.ZodOptional<z.ZodString>;
    memberAgentIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    kickoff: z.ZodOptional<z.ZodString>;
    leadAgentId: z.ZodOptional<z.ZodString>;
    channel: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "create" | "invite";
    name?: string | undefined;
    channel?: string | undefined;
    leadAgentId?: string | undefined;
    memberAgentIds?: string[] | undefined;
    kickoff?: string | undefined;
}, {
    action: "create" | "invite";
    name?: string | undefined;
    channel?: string | undefined;
    leadAgentId?: string | undefined;
    memberAgentIds?: string[] | undefined;
    kickoff?: string | undefined;
}>;
type CreateChannelInput = z.infer<typeof CreateChannelParameters>;
export declare class CreateChannelTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly wakeService?: ChannelWakeService;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["create", "invite"]>;
        name: z.ZodOptional<z.ZodString>;
        memberAgentIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        kickoff: z.ZodOptional<z.ZodString>;
        leadAgentId: z.ZodOptional<z.ZodString>;
        channel: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "create" | "invite";
        name?: string | undefined;
        channel?: string | undefined;
        leadAgentId?: string | undefined;
        memberAgentIds?: string[] | undefined;
        kickoff?: string | undefined;
    }, {
        action: "create" | "invite";
        name?: string | undefined;
        channel?: string | undefined;
        leadAgentId?: string | undefined;
        memberAgentIds?: string[] | undefined;
        kickoff?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    toAutoClassifierInput(_input: unknown): string;
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    execute(input: CreateChannelInput, context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * 发言（有 kickoff）+ 唤醒。返回实际唤醒人数；无 wakeService 时返回 0 并记日志。
     * `speechError` = kickoff 没落进频道（身份 / 目录 / 频道问题）：必须回给调用方，
     * 否则工具会报 "Woke N" 而房间里根本没有那句话（实测踩过）。
     */
    private speakAndWake;
}
export {};
