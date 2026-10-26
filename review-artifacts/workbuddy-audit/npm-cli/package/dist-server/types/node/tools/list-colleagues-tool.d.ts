/**
 * ListColleagues —— Agent Home 通讯录：现有同事 + 频道，都带 id。
 *
 * 为什么必须有它：CreateChannel 要 `memberAgentIds`（id），ChannelTasks / SpeakInChannel
 * 要 `channel`（id），而注入的组队提示为了省 token 会把名册截断（`(+N more)`）——
 * 模型拿不到后面的 id，就只能猜、把已有同事重复建一遍，或者干脆卡住问用户。
 * 一次调用把「有谁、在哪几个频道、谁是 lead」给全。
 *
 * 只读：走 channelsForSelf（和工具口径一致），不拿目录锁。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolNames, ToolResult } from './tool-protocol';
export declare class ListColleaguesTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    description: string;
    needsApproval: boolean;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
    argumentRenderer: ToolCallArgumentRenderer;
    toAutoClassifierInput(_input: unknown): string;
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    execute(_input: unknown, context?: RunContext<Session>): Promise<ToolResult>;
}
