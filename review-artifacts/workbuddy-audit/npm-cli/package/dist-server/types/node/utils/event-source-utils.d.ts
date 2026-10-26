import { IncomingMessage } from 'node:http';
/**
 * Represents a message sent in an event stream
 * https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#Event_stream_format
 */
export interface EventSourceMessage {
    /** The event ID to set the EventSource object's last event ID value. */
    id: string;
    /** A string identifying the type of event described. */
    event: string;
    /** The event data */
    data: string;
    /** The reconnection interval (in milliseconds) to wait before retrying the connection */
    retry?: number;
}
export declare class EventSourceUtils {
    /**
     * Converts a ReadableStream into a callback pattern.
     * @param stream The input ReadableStream.
     * @param onChunk A function that will be called on each new byte chunk in the stream.
     * @returns {Promise<void>} A promise that will be resolved when the stream closes.
     */
    static getBytes(stream: IncomingMessage, onChunk: (arr: Uint8Array) => void): Promise<void>;
    /**
     * Parses arbitary byte chunks into EventSource line buffers.
     * Each line should be of the format "field: value" and ends with \r, \n, or \r\n.
     * @param onLine A function that will be called on each new EventSource line.
     * @returns A function that should be called for each incoming byte chunk.
     */
    static getLines(onLine: (line: Uint8Array, fieldLength: number) => void): (arr: Uint8Array) => void;
    /**
     * Parses line buffers into EventSourceMessages.
     * @param onId A function that will be called on each `id` field.
     * @param onRetry A function that will be called on each `retry` field.
     * @param onMessage A function that will be called on each message.
     * @returns A function that should be called for each incoming line buffer.
     */
    static getMessages(onId: (id: string) => void, onRetry: (retry: number) => void, onMessage?: (msg: EventSourceMessage) => void): (line: Uint8Array, fieldLength: number) => void;
    static concat(a: Uint8Array, b: Uint8Array): Uint8Array;
    static newMessage(): EventSourceMessage;
}
