import type { Session } from '../../../vendor/cbc-core/node/index.js';
import type { RunContext } from '../../agent';
import type { McpTool } from '../../mcp/mcp-protocol';
import { type ToolPermissionResult } from '../tool-protocol';
import { type McpToolIdentity } from './protocol';
export declare function createMcpToolIdentity(hostConnectionId: string, exposedToolName: string, annotations?: Record<string, unknown>): McpToolIdentity;
export declare function reviewMcpPermission(input: {
    tool: McpTool;
    hostConnectionId: string;
    inputSchemaFingerprint: string;
    runContext: RunContext<Session>;
    toolInput: unknown;
    toolCallId?: string;
    permissionFloor?: ToolPermissionResult;
}): Promise<boolean>;
