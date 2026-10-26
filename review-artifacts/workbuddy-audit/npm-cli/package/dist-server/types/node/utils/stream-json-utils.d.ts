import { type AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
/**
 * Utilities for converting stream-json format to AgentInputItem format
 */
export declare abstract class StreamJsonUtils {
    /**
     * Parse stream-json messages from pipe input and convert to AgentInputItem[]
     * Each line should be a valid JSON UserMessage
     */
    static parseMessagesFromPipeInput(pipeInput: string, fallbackConversationRequestId?: unknown): AgentInputItem[];
    /**
     * Convert UserMessage (stream-json format) to AgentInputItem
     */
    private static convertUserMessage;
    /**
     * Build data URI from raw data, avoiding duplicate prefix
     */
    private static buildDataUri;
    /**
     * Convert ContentBlock from stream-json format to agent input format
     */
    private static convertContentBlock;
    /**
     * Parse UserMessage from JSON string
     */
    private static parseUserMessage;
}
