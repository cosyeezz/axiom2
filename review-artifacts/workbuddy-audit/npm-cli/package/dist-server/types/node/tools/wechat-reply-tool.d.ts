/**
 * WechatReply Tool
 *
 * Allows the AI to send replies back to WeChat users via the WechatChannelBridge.
 * Dynamically enabled/disabled based on WeChat connection status.
 */
import { z } from 'zod';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, type ToolResult } from './tool-protocol';
export declare class WechatReplyTool extends BaseTool implements Tool {
    name: string;
    description: string;
    needsApproval: boolean;
    /**
     * Only enabled when WeChat is connected.
     * Checks WechatClient status dynamically at each agent run.
     */
    isEnabled: () => boolean;
    parameters: z.ZodObject<{
        chat_id: z.ZodString;
        text: z.ZodOptional<z.ZodString>;
        file_path: z.ZodOptional<z.ZodString>;
        context_token: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        chat_id: string;
        text?: string | undefined;
        file_path?: string | undefined;
        context_token?: string | undefined;
    }, {
        chat_id: string;
        text?: string | undefined;
        file_path?: string | undefined;
        context_token?: string | undefined;
    }>;
    execute(input: {
        chat_id: string;
        text?: string;
        file_path?: string;
        context_token?: string;
    }, context?: RunContext<Session>): Promise<ToolResult>;
}
