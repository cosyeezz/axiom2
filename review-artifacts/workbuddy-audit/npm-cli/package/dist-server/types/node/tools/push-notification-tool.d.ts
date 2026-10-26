import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { TerminalNotificationService } from '../notification/notification-protocol';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const PushNotificationParameters: z.ZodObject<{
    message: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    message: string;
    title?: string | undefined;
}, {
    message: string;
    title?: string | undefined;
}>;
/**
 * PushNotification 工具（issue #74424）——允许模型在长任务/后台任务/定时任务完成时
 * 主动触发一次终端/桌面通知，填补现有通知机制的空白：`sendNotification` 目前只在
 * PERMISSION_PROMPT（需要审批）和 IDLE_PROMPT（空闲 60 秒后）两种场景触发，模型自己
 * 判断"任务刚完成、该提醒一下"这个时机是空白的。
 *
 * 默认开启（不同于 ComputerUse 默认关闭），可用 CODEBUDDY_PUSH_NOTIFICATION_ENABLED 覆盖。
 *
 * 不做企微/微信转发：这部分与已有的 WeComReply/WeChatReply 工具重叠（模型在 channel
 * session 里会自己抢先调用它们），且转发目标依赖 session.meta 上的覆盖式单值字段
 * （channelChatId 等），同一 session 同时连接多个渠道时只认最后联系过的那个，行为
 * 不可预期，因此本工具只保留终端通知这一确定性的部分。
 */
export declare class PushNotificationTool extends BaseTool implements Tool {
    protected readonly terminalNotificationService: TerminalNotificationService;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        message: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        message: string;
        title?: string | undefined;
    }, {
        message: string;
        title?: string | undefined;
    }>;
    needsApproval: boolean;
    private isPushNotificationEnabled;
    isEnabled: (_args?: unknown) => Promise<boolean>;
    /**
     * 同步镜像 isEnabled 的 gate，用于 ToolSearch 延迟工具列表可见性过滤。
     * gate 未开时不应出现在 "Available deferred tools" 描述里，避免模型误判此工具可用。
     */
    shouldShowInToolSearch: () => boolean;
    execute(input: z.infer<typeof PushNotificationParameters>, context: RunContext<Session>): Promise<ToolResult>;
}
export {};
