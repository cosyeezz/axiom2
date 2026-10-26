import { Logger } from '@celljs/core';
import { z } from 'zod';
import { RunContext } from '../../vendor/cbc-shared/node/index.js';
import { McpManager } from '../mcp/mcp-protocol';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const WaitForMcpServersParameters: z.ZodObject<{
    servers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    servers?: string[] | undefined;
}, {
    servers?: string[] | undefined;
}>;
type WaitForMcpServersInput = z.infer<typeof WaitForMcpServersParameters>;
interface WaitForMcpServersOutput {
    ready: boolean;
    connected: string[];
    failed: string[];
    stillPending: string[];
    needsAuth: string[];
    disabled: string[];
    unknown: string[];
}
/**
 * WaitForMcpServers — wait for MCP servers that are still connecting.
 *
 * When a user's request needs tools from a still-connecting server, the LLM
 * can call this tool to block until the server finishes connecting. Once
 * connected, its tools are added to the tool list and can be used directly.
 *
 * Returns ready=true when all target servers are connected, ready=false if
 * any failed to connect, need authentication, or are disabled.
 */
export declare class WaitForMcpServersTool extends BaseTool implements Tool {
    protected readonly mcpManager: McpManager;
    protected readonly logger: Logger;
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        servers: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        servers?: string[] | undefined;
    }, {
        servers?: string[] | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    /** No approval needed — this is a read-only wait operation. */
    needsApproval: boolean;
    /**
     * Enabled iff the feature is not explicitly disabled via env
     * CODEBUDDY_WAIT_FOR_MCP_SERVERS_ENABLED=0/false.
     *
     * Historically this also returned false when no MCP server was in
     * CONNECTING state. That coupling caused a time-of-check race with the
     * ToolSearch description: the description is rendered once per session
     * with the "still connecting" hint baked in, but isEnabled() was
     * re-evaluated on every LLM request — so a server that finished
     * connecting between description-render and tool-list-fetch would leave
     * the hint pointing at a tool the LLM no longer had access to.
     *
     * Always exposing the tool removes that drift: when no server is
     * connecting, execute() returns ready=true immediately (cost ~1ms) and
     * the tool description itself tells the LLM what it is for, so the
     * model won't invoke it gratuitously.
     *
     * Default: enabled. WB sets this env var to '0' to disable.
     */
    isEnabled: () => Promise<boolean>;
    execute(input: WaitForMcpServersInput, _context: RunContext<Session>): Promise<ToolResult>;
    private getPendingServerNames;
    private matchTargets;
    private classifyResults;
    private buildResult;
    private sleep;
}
export { WaitForMcpServersParameters };
export type { WaitForMcpServersInput, WaitForMcpServersOutput };
