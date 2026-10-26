/**
 * The REPL worker protocol, as a `@genie/cbc-worker` ProtocolSpec: what the manager (host) sends
 * and what the worker (guest) sends. Both sides import this module, so it stays free of
 * dependencies beyond the protocol types: the worker build inlines it.
 *
 *   host → guest  request  `exec`                      ExecRequest → ExecReply
 *   host → guest  notice   `init` / `toolsUpdate`      ToolsUpdate
 *   guest → host  request  `toolCall` / `replApi` / `resolve` / `bridgeOp`
 *                                                       answered with the payload shapes the broker returns
 *   guest → host  notice   `output` / `toolsReady` / `unwound`
 */
import type { ProtocolSpec } from '../../../vendor/cbc-worker/node/protocol/index.js';
/** Bumped whenever a frame changes shape; the host refuses a worker built for another value. */
export declare const REPL_WORKER_PROTOCOL = 1;
/** `ToolsUpdate.capability` 前缀：会话处于委托模式（协调者沙箱只剩委托白名单）。 */
export declare const REPL_DELEGATE_CAPABILITY_PREFIX = "delegate|";
export interface ExecRequest {
    callId: string;
    code: string;
    timeoutMs: number;
    resultLimitBytes: number;
}
/** The cell's outcome. A failing cell is a normal reply (`ok: false`), not a transport error. */
export interface ExecReply {
    ok: boolean;
    result?: unknown;
    images: unknown[];
    resultTruncated?: boolean;
    error?: string;
}
export interface ToolsUpdateTool {
    name: string;
    displayName: string;
    category?: string;
}
export interface ToolsUpdateServer {
    globalName: string;
    server?: string;
    tools?: Array<{
        method: string;
        canonical: string;
        owner?: string;
    }>;
}
export interface ToolsUpdate {
    epoch: number;
    /** Session capability fingerprint; absent means unchanged / not applicable. */
    capability?: string;
    builtins: ToolsUpdateTool[];
    servers: ToolsUpdateServer[];
    removeServers: string[];
    removeTools: string[];
}
export interface OutputEvent {
    stream: 'stdout' | 'stderr';
    data: string;
}
export interface UnwoundEvent {
    callId: string;
}
export interface ToolsReadyEvent {
    epoch: number;
}
export interface ToolCallRequest {
    toolName: string;
    params: Record<string, unknown>;
    expectedMcpOwner?: string;
}
/** The broker's answer as the cell sees it: `{ result }` or `{ error }`, never a throw. */
export interface ToolCallReply {
    result?: unknown;
    error?: string;
}
export interface ReplApiRequest {
    api: string;
    args: unknown[];
}
export interface ReplApiReply {
    result?: unknown;
    error?: string;
}
export interface ResolveRequest {
    specifier: string;
}
export type ResolveReply = {
    specifier: string;
    exports?: string[];
    documentation?: unknown;
} | null;
export interface BridgeOpRequest {
    specifier: string;
    method: string;
    args: unknown[];
}
export interface BridgeOpReply {
    ok: boolean;
    value?: unknown;
    error?: string;
}
export type ReplProtocol = ProtocolSpec & {
    host: {
        requests: {
            exec: {
                payload: ExecRequest;
                reply: ExecReply;
            };
        };
        notices: {
            init: ToolsUpdate;
            toolsUpdate: ToolsUpdate;
        };
    };
    guest: {
        requests: {
            toolCall: {
                payload: ToolCallRequest;
                reply: ToolCallReply;
            };
            replApi: {
                payload: ReplApiRequest;
                reply: ReplApiReply;
            };
            resolve: {
                payload: ResolveRequest;
                reply: ResolveReply;
            };
            bridgeOp: {
                payload: BridgeOpRequest;
                reply: BridgeOpReply;
            };
        };
        notices: {
            output: OutputEvent;
            toolsReady: ToolsReadyEvent;
            unwound: UnwoundEvent;
        };
    };
};
