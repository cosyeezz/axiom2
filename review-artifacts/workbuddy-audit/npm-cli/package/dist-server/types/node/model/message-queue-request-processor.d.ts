import { Logger } from '@genie/telemetry';
import { ModelRequestProcessor } from './model-protocol';
/**
 * Processor to append queued messages to the request before sending
 */
export declare class MessageQueueRequestProcessor implements ModelRequestProcessor {
    protected readonly logger: Logger;
    init(): void;
    process(axiosConfig: any): Promise<void>;
    /**
     * Get the unique key for a message (tool_call_id or messageId)
     * @param message The message to get key from
     * @returns The tool_call_id if present, otherwise messageId, or undefined if neither exists
     */
    private getMessageKey;
    /** Queue items that are never injected mid-run. */
    private staysQueued;
    /** Chat `image_url` blocks → Responses `input_image` parts, restored like model-layer images. */
    private toResponsesImages;
    /**
     * Record the queued message in session for subsequent requests
     * @param session Current session
     * @param messageKey The tool_call_id or messageId of the previous message
     * @param queuedMessage The message that was inserted
     */
    private recordQueuedMessage;
    /**
     * Re-insert previously recorded queued messages into the messages array
     * @param session Current session
     * @param messages The messages array to modify
     */
    /** @returns whether any message was inserted */
    private reinsertRecordedMessages;
    /**
     * Check if two messages are the same queued message
     */
    private isSameQueuedMessage;
    /**
     * Build the text representation of queued messages and add them to history.
     *
     * Previously this extracted plain text and called addHistory(session, string),
     * which created a brand-new UserMessage without providerData — causing
     * teammate messages to lose their sender identity (teammateMessage.from).
     *
     * Now we pass the original AgentInputItem[] to addHistory so providerData
     * (including teammateMessage) is preserved for correct UI rendering.
     */
    /**
     * Build the mid-run injection payload for queued messages: a `<system-reminder>`
     * text block (from the queued messages' text) plus every queued image as an
     * `image_url` content block, and add the original items to history.
     *
     * Why images matter here: steer messages sent while the agent is running are
     * consumed at the next model request via this processor. Previously only text
     * survived — image steers (content with an `input_image` block) produced no
     * text, so they were skipped entirely and, when a text steer coexisted, dropped
     * from the queue without ever reaching the model. Now their image blocks are
     * injected alongside the reminder text so the model actually sees them.
     *
     * We pass the original AgentInputItem[] to addHistory so providerData
     * (including teammateMessage sender identity) is preserved for UI rendering.
     */
    private buildQueuedMessagesContent;
    /**
     * Check if message text is a slash command (e.g. /commit, /review-pr).
     * Also handles <channel> wrapped messages where the command is inside the tag.
     */
    private isSlashCommand;
    /**
     * Extract every image content block from a message content array and normalize
     * it to the OpenAI `image_url` wire shape expected in `body.messages`.
     *
     * Handles the two shapes user images can take:
     *  - `{ type: 'input_image', image: 'data:...' | { url } }` (fresh, in-memory)
     *  - `{ type: 'image_url', image_url: { url } }` (already wire-shaped)
     * Dehydrated `image_blob_ref` blocks are intentionally not rehydrated here —
     * those come from persisted history, not from a live queued steer message.
     */
    private extractImageBlocks;
    /**
     * Extract text from message content. Scans ALL text blocks (not just the last),
     * so a steer message that mixes text and an image (e.g. text block followed by
     * an input_image block) still yields its text instead of returning empty.
     */
    private extractTextFromContent;
}
