/**
 * WeComReply Tool
 *
 * Allows the AI to send replies back to WeCom (企业微信) users via the WecomBotChannelBridge.
 * Dynamically enabled/disabled based on WeCom connection status.
 * Supports multiple client instances — any connected instance enables the tool.
 *
 * Supports:
 *   - text: plain markdown text
 *   - image_url: image URL (data: or http:) to upload and send
 *   - file_path: local file path to upload and send
 *   - file_url: remote file URL to download and send
 */
import { z } from 'zod';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import type { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, type ToolResult } from './tool-protocol';
export declare class WecomReplyTool extends BaseTool implements Tool {
    name: string;
    description: string;
    needsApproval: boolean;
    /**
     * Enabled when any WeCom client instance is connected.
     */
    isEnabled: () => boolean;
    parameters: z.ZodObject<{
        chat_id: z.ZodString;
        text: z.ZodOptional<z.ZodString>;
        image_url: z.ZodOptional<z.ZodString>;
        file_path: z.ZodOptional<z.ZodString>;
        file_url: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        chat_id: string;
        text?: string | undefined;
        file_path?: string | undefined;
        image_url?: string | undefined;
        file_url?: string | undefined;
    }, {
        chat_id: string;
        text?: string | undefined;
        file_path?: string | undefined;
        image_url?: string | undefined;
        file_url?: string | undefined;
    }>;
    execute(input: {
        chat_id: string;
        text?: string;
        image_url?: string;
        file_path?: string;
        file_url?: string;
    }, context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * Upload and send media via WebSocket (WecomBotClient.uploadMedia + sendMediaMessage).
     */
    private sendMedia;
    /**
     * Detect WeCom media type from filename extension.
     */
    private detectMediaType;
    /**
     * Convert URL (data: or http:) or local path to Buffer.
     */
    private urlToBuffer;
}
