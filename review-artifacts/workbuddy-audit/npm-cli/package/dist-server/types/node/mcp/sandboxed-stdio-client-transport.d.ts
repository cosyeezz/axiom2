import { type Stream } from 'node:stream';
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { ISandboxCLILifecycle } from '../sandbox-cli/sandbox-cli-lifecycle-protocol';
/**
 * MCP stdio transport backed by the current Agent sandbox-cli session.
 *
 * The SDK is imported dynamically when start() is called. Keeping every
 * top-level MCP SDK import type-only prevents this transport from pulling the
 * SDK back into the lite-wb initial chunk.
 */
export declare class SandboxedStdioClientTransport implements Transport {
    private readonly serverParams;
    private readonly lifecycle;
    private readonly stderrStream;
    private readonly closeSignal;
    private resolveCloseSignal;
    private readBuffer;
    private serializeMessage;
    private client;
    private sandboxSessionId;
    private processId;
    private remotePid;
    private started;
    private closed;
    private closeNotified;
    private closePromise;
    private outputDisposer;
    private exitDisposer;
    private disconnectDisposer;
    private pendingEvents;
    private pendingRunCompletion;
    private exitPromise;
    private resolveExit;
    private writeTail;
    private writeFailure;
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    sessionId?: string;
    constructor(serverParams: StdioServerParameters, lifecycle: ISandboxCLILifecycle);
    get stderr(): Stream | null;
    get pid(): number | null;
    start(): Promise<void>;
    send(message: JSONRPCMessage): Promise<void>;
    close(): Promise<void>;
    private doClose;
    private loadFraming;
    private buildRunRequest;
    private waitForSandboxReady;
    private bindClientEvents;
    private handleOutputMessage;
    private handleExitMessage;
    private flushPendingEvents;
    private processReadBuffer;
    private writeBytes;
    private killProcess;
    private withClose;
    private cleanup;
    private notifyClose;
}
