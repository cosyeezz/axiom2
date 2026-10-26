/**
 * WeComChannel tool.
 *
 * Lets the agent read channel (频道) context that the inbound event does not carry:
 * which channels the bot joined, all posts of a channel, and all replies under a post.
 * Content is pulled over HTTPS via WecomTopicApi; replying happens through WeComReply.
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, type ToolResult } from './tool-protocol';
export declare class WeComChannelTool extends BaseTool implements Tool {
    name: string;
    description: string;
    needsApproval: boolean;
    /** Enabled when a WeCom channel-consuming bot (topicEvents) is connected. */
    isEnabled: () => boolean;
    parameters: z.ZodObject<{
        action: z.ZodEnum<["channels", "posts", "replies"]>;
        chat_id: z.ZodOptional<z.ZodString>;
        topic_id: z.ZodOptional<z.ZodString>;
        post_id: z.ZodOptional<z.ZodString>;
        limit: z.ZodOptional<z.ZodNumber>;
        cursor: z.ZodOptional<z.ZodString>;
        sort: z.ZodOptional<z.ZodEnum<["oldest", "newest"]>>;
    }, "strip", z.ZodTypeAny, {
        action: "channels" | "posts" | "replies";
        sort?: "oldest" | "newest" | undefined;
        cursor?: string | undefined;
        limit?: number | undefined;
        chat_id?: string | undefined;
        post_id?: string | undefined;
        topic_id?: string | undefined;
    }, {
        action: "channels" | "posts" | "replies";
        sort?: "oldest" | "newest" | undefined;
        cursor?: string | undefined;
        limit?: number | undefined;
        chat_id?: string | undefined;
        post_id?: string | undefined;
        topic_id?: string | undefined;
    }>;
    execute(input: {
        action: 'channels' | 'posts' | 'replies';
        chat_id?: string;
        topic_id?: string;
        post_id?: string;
        limit?: number;
        cursor?: string;
        sort?: 'oldest' | 'newest';
    }, _context?: RunContext<Session>): Promise<ToolResult>;
    /** Resolve the channel id from the inbound meta (chat_id) or an explicit topic_id. */
    private resolveTopicId;
    /**
     * Any connected client that consumes channel events. The channel id is not needed
     * here: the HTTPS API is bound to the bot credentials, not to a chat route.
     */
    private resolveApi;
}
