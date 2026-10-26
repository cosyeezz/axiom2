import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { ToolResult } from '../tools/tool-protocol';
import type { ToolRiskReviewService } from '../tools/tool-risk-review/protocol';
import type { DeferredToolInfo } from '../tools/tool-search-protocol';
import { type McpConfig, McpScope, type McpTool } from './mcp-protocol';
/** Metadata is authoritative only on a host-registered builtin, never a user/project MCP. */
export declare function resolveMcpSensitiveResultPolicy(tool: McpTool, config: McpConfig, scope?: McpScope): string | undefined;
export declare function applyMcpSensitiveResultPolicy(result: ToolResult, info: Pick<DeferredToolInfo, 'name' | 'rawToolName' | 'sensitiveResultPolicy'> | undefined, session: Session | undefined, toolCallId: string | undefined, review: Pick<ToolRiskReviewService, 'recordTrustedHostResult'> | undefined): ToolResult;
