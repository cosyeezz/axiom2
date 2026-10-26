import type { McpServerModel, McpServerModelManager } from '../../mcp/mcp-protocol';
import type { ToolIdentity } from './protocol';
/** The source reference lives only in the existing review record, never in MCP config or tool metadata. */
export declare function resolveTrustedMcpAction(identity: ToolIdentity, input: unknown, models?: Pick<McpServerModelManager, 'get'>): McpServerModel | undefined;
