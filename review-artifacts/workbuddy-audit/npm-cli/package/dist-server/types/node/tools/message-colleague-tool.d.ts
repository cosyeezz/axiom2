import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { SettingsManager } from '../settings/settings-protocol';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * MessageColleague —— Agent Home 的 1:1（通讯录可达即能发）。
 *
 * 目标是"某个人"（上游 SendToAgent 的语义），不是"某个房间成员"：
 * 同事发到他的 job 收件箱（死了就拉起）；主 Agent（委托人）发到主会话邮箱
 * （落盘，主会话 idle 时注入）。频道群对话走 SpeakInChannel，不是这个工具。
 * 和 Agent Teams 的 SendMessage 无关。
 */
export declare class MessageColleagueTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly settingsManager?: SettingsManager;
    name: ToolNames;
    description: string;
    needsApproval: boolean;
    /**
     * 通讯录里没人（且不是自己）时，它既不在工具列表里，也不出现在 ToolSearch 的
     * "Available deferred tools" 描述里，模型不会知道有这么个东西。
     */
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        action: z.ZodOptional<z.ZodEnum<["list", "send", "incoming"]>>;
        recipient: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        text: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        summary?: string | undefined;
        text?: string | undefined;
        content?: string | undefined;
        action?: "list" | "send" | "incoming" | undefined;
        from?: string | undefined;
        recipient?: string | undefined;
    }, {
        summary?: string | undefined;
        text?: string | undefined;
        content?: string | undefined;
        action?: "list" | "send" | "incoming" | undefined;
        from?: string | undefined;
        recipient?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /**
     * 房间 ACL 已经挡住了能联系谁；问候同事不必再走 auto 分类器，
     * 否则模型已经决定发了，UI 还会再问一次确认。
     */
    toAutoClassifierInput(_input: unknown): string;
    private cachedTargets?;
    private cachedAt;
    /** 通讯录里还有别人 → 工具出现。主 Agent 也算（同事要能回报它）。 */
    private hasReachableTarget;
    /**
     * 可见性用的通讯录（**宽松**）：未认领的 job 也解析成默认 Agent → 有人就返回非空。
     * 动作路径不信这份缓存，自己用 strict 重新解析（见 execute）。
     */
    private targets;
    /**
     * 极简没有组队 / 互感知：工具不出现。其他人走通讯录（有人就能发）。
     */
    isEnabled: (args?: {
        runContext?: RunContext<Session>;
        agent?: {
            name?: string;
        };
    }) => Promise<boolean>;
    /** 每个成员此刻在干嘛：读的是和侧栏同一份 Run 状态，不另开数据源。 */
    private describeContact;
    execute(input: {
        action?: string;
        recipient?: string;
        content?: string;
        summary?: string;
        from?: string;
        text?: string;
    }, context?: RunContext<Session>): Promise<ToolResult>;
}
