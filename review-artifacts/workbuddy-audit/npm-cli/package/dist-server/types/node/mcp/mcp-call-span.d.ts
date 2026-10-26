import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type W3CTraceContextMeta } from '@genie/telemetry';
/**
 * Run a callback with the per-call execute span installed in the async-local
 * propagation scope. The span is resolved by call id instead of being stored
 * on a mutable session field, so concurrent tool calls cannot overwrite one
 * another's parent context.
 */
export declare function runWithToolExecutionContext<T>(session: Session | undefined, callId: string | undefined, callback: () => T): T;
/**
 * Build the W3C carrier for an outgoing tool call. The execute span supplies
 * the wire parent; the active turn supplies its baggage. Without a span, only the
 * current async-local turn is eligible; never fall back to stale Session data.
 */
export declare function toolExecutionPropagationCarrier(session: Session | undefined, callId: string | undefined): W3CTraceContextMeta;
/**
 * 包裹 MCP `callTool` 真正打到 MCP server 的网络往返（`Reflect.apply(target.callTool, ...)`），
 * 创建 `codebuddy_code.mcp_call` 子 span，嵌套在触发该次调用的 `codebuddy_code.tool` 下。
 *
 * 依赖调用方（`mcp-server-manager.ts`）在同一次调用里生成稳定的 `callId`，并把它同时传给
 * `executePreToolUseHooks` / `executePostToolUseHooks`，从而保证外层 tool span 一定存在。
 */
export declare function withMcpCallSpan<T>(session: Session | undefined, serverName: string, toolName: string, callId: string | undefined, fn: () => Promise<T>): Promise<T>;
