import { type Session } from '../../../vendor/cbc-core/node/index.js';
import { type McpToolCallResult } from '../../mcp/mcp-call-result';
/** The tool retains validation, policy and execution hooks; API does not dispatch arbitrary events. */
export declare function invokeRegisteredModTool(session: Session, name: string, input: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>>;
/**
 * The existing deferred tool retains MCP discovery, schema checks, routing and permission decisions.
 * Answers the official `McpToolResult`: `{ content, isError, structuredContent? }` as the server returned it.
 */
export declare function invokeModMcpTool(session: Session, server: string, tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<McpToolCallResult>;
