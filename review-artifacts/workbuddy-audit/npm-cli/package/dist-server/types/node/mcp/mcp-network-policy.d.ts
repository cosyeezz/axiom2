import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { SandboxNetworkTarget } from '../tools/sandbox-write-rule-guard';
import type { McpConfig } from './mcp-protocol';
/** Browser 导航与 HTTP MCP 共用同一套归一化，两边的会话审批键（`host:port`）才能互认。 */
export declare function toSandboxNetworkTarget(url: URL): SandboxNetworkTarget;
/** 把一次 MCP 工具调用的出网目标交给共享的沙箱网络守卫（裁决、审计、审批卡片）。 */
export declare function ensureMcpNetworkTargetAllowed(target: SandboxNetworkTarget, toolName: string, args: Record<string, unknown> | null, session?: Session, signal?: AbortSignal, toolCallId?: string, auditMetadata?: Record<string, unknown>): Promise<void>;
/**
 * Checks the upstream origin of an HTTP/SSE MCP tool call against Security Center network rules.
 * Only `tools/call` is gated; connect / `initialize` / `tools/list` are intentionally left alone.
 */
export declare function checkMcpHttpNetworkPolicy(config: McpConfig, serverName: string, toolName: string, args: Record<string, unknown> | null, session?: Session, signal?: AbortSignal, toolCallId?: string): Promise<void>;
