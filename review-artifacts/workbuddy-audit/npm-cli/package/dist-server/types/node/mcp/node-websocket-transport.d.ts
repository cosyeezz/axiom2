import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
interface WebSocketLike {
    readonly readyState: number;
    close(code?: number, reason?: string): void;
    send(data: string): void;
}
export declare class NodeWebSocketTransport implements Transport {
    private ws;
    private started;
    private opened;
    private isBun;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    constructor(ws: WebSocketLike);
    private onBunMessage;
    private onBunError;
    private onBunClose;
    private onNodeMessage;
    private onNodeError;
    private onNodeClose;
    private handleError;
    private handleCloseCleanup;
    /**
     * Start the transport (MCP Transport interface)
     */
    start(): Promise<void>;
    /**
     * Close the transport (MCP Transport interface)
     */
    close(): Promise<void>;
    /**
     * Send message through transport (MCP Transport interface)
     */
    send(message: JSONRPCMessage): Promise<void>;
}
export {};
