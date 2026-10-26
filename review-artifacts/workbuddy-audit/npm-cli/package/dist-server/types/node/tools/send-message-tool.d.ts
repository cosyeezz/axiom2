import { type AgentRunScope as IAgentRunScope, type Session } from '../../vendor/cbc-core/node/index.js';
import { type RunContext, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
/**
 * Structured data for SendMessage tool rendering.
 * This is passed to the UI layer via renderer.value for human-like display.
 */
export interface SendMessageRenderData {
    /** Message type: message, broadcast, shutdown_request, shutdown_response, plan_approval_response */
    type: 'message' | 'broadcast' | 'shutdown_request' | 'shutdown_response' | 'plan_approval_response';
    /** Sender name (for display context) */
    sender: string;
    /** Recipient name or '@team' for broadcast */
    recipient?: string;
    /** Recipient's color for display */
    recipientColor?: string;
    /** Short summary/preview text */
    summary?: string;
    /** Result message shown below the header */
    resultMessage: string;
    /** For shutdown/plan_approval: whether approved */
    approved?: boolean;
    /** Number of recipients for broadcast */
    recipientCount?: number;
}
/**
 * SendMessage tool - unified messaging for Agent Team communication.
 *
 * Supports 5 message types:
 *   - message: Direct message to a specific teammate
 *   - broadcast: Message to all teammates (use sparingly)
 *   - shutdown_request: Request a teammate to shut down
 *   - shutdown_response: Respond to a shutdown request
 *   - plan_approval_response: Approve or reject a plan
 */
interface SendMessageInput {
    type: string;
    recipient?: string;
    content?: string;
    summary?: string;
    request_id?: string;
    approve?: boolean;
}
/** Official `SessionSendResult` of what the tool answered: delivered, or why not in its words. */
export declare function sendResultOf(result: ToolResult): {
    isDelivered: true;
} | {
    isDelivered: false;
    reason: string;
};
/** A plugin's `$.session.send` at the bottom of its chain: the tool's own send from `session`. */
export declare function sendFromPlugin(session: Session, to: string, text: string): Promise<{
    isDelivered: true;
} | {
    isDelivered: false;
    reason: string;
}>;
export declare class SendMessageTool extends BaseTool implements Tool {
    protected readonly logger: Logger;
    protected readonly agentRunScope?: IAgentRunScope;
    name: ToolNames;
    description: string;
    shouldShowInToolSearch: () => boolean;
    parameters: z.ZodObject<{
        type: z.ZodEnum<["message", "broadcast", "shutdown_request", "shutdown_response", "plan_approval_response"]>;
        recipient: z.ZodOptional<z.ZodString>;
        content: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        request_id: z.ZodOptional<z.ZodString>;
        approve: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        type: "message" | "broadcast" | "shutdown_request" | "shutdown_response" | "plan_approval_response";
        summary?: string | undefined;
        content?: string | undefined;
        request_id?: string | undefined;
        approve?: boolean | undefined;
        recipient?: string | undefined;
    }, {
        type: "message" | "broadcast" | "shutdown_request" | "shutdown_response" | "plan_approval_response";
        summary?: string | undefined;
        content?: string | undefined;
        request_id?: string | undefined;
        approve?: boolean | undefined;
        recipient?: string | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    needsApproval: boolean;
    /**
     * Auto mode classifier projection (Claude alignment, decision D1): a plain
     * message projects `to ${recipient}: ${content}`; structured control messages
     * (shutdown / plan-approval) project a short summary. Consumed in history —
     * SendMessage has `needsApproval = false`, so the current action never reaches
     * the classifier directly.
     */
    toAutoClassifierInput(input: unknown): string;
    isEnabled: () => boolean;
    execute(input: SendMessageInput, context?: RunContext<Session>): Promise<ToolResult>;
    /** The tool's own send, under no `session.send` hook (a plugin's call is already inside one). */
    deliver(input: SendMessageInput, context?: RunContext<Session>): Promise<ToolResult>;
    /**
     * Resolve a recipient by name, checking both formal TeamManager and implicit TeamMemberRegistry.
     * `teamName` scopes the implicit registry lookup so cross-team same-name members
     * cannot be matched as this sender's recipient.
     *
     * Falls back to a single `refreshFromDisk()` re-read when neither in-memory
     * source has the recipient. This closes the spawn-race window where one
     * teammate has been persisted to `config.json` but not yet reflected in
     * the current process's TeamManager snapshot (e.g. concurrent spawns).
     */
    private resolveRecipient;
    /**
     * Map a recipient name to its canonical form (e.g. "main" → "team-lead").
     */
    private resolveRecipientName;
    /**
     * Notify an in-process logical actor after its inbox append is durable.
     * The actor owns serialization and revalidates the human-turn lease at the
     * actual paused -> running boundary.
     */
    private kickRecipient;
    /**
     * Get all known member names from both formal TeamManager and TeamMemberRegistry.
     */
    private getAllMemberNames;
    private handleMessage;
    private handleBroadcast;
    private handleShutdownRequest;
    private handleShutdownResponse;
    private handlePlanApprovalResponse;
}
export {};
