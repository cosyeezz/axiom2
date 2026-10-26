/**
 * OrderedToolsAgent 的 async factory shim（standby lazy 化 #107267）。
 *
 * ## 背景
 *
 * `OrderedToolsAgent extends Agent` 里的 `Agent` 走 openai-agents-types 的 lazy
 * binding —— `class X extends Y {}` 是 module-load 时求值的运算，若 Y 是
 * undefined（未 preload）module 加载就崩。
 *
 * ## 解法（对齐 mcp-server-override 的分层）
 *
 * - `./ordered-tools-agent-impl.ts` 保留 static import SDK + subclass 定义
 * - 本 shim 只 `import type` + async factory + 纯函数 `orderToolsForPromptCache`
 * - caller 从 `new OrderedToolsAgent(opts)` 改成 `await createOrderedToolsAgent(opts)`
 *
 * 唯一 caller 在 agent/agent-factory.ts:36。spec 需要访问 class prototype 时
 * 直接从 `./ordered-tools-agent-impl` import。
 */
import type { AgentOptions } from '../../../cbc-shared/node/index.js';
import type { AgentRunStage } from './agent-runtime-protocol';
import type { OrderedToolsAgent as OrderedToolsAgentImpl } from './ordered-tools-agent-impl';
export interface OrderedToolsAgentOptions<TContext> extends AgentOptions<TContext, any> {
    observeRunPhase?: <T>(context: TContext, stage: AgentRunStage, operation: () => Promise<T>, attributes?: Record<string, unknown>, resultAttributes?: (result: T) => Record<string, unknown>) => Promise<T>;
}
/**
 * Stable-partitions the model-facing tool list without changing any tool
 * objects or the relative order within a partition.
 *
 * SDK getAllTools() returns enabled entries from `agent.tools` by reference,
 * while MCP entries are created separately for the current run. Object
 * identity therefore distinguishes both sources even for bare-name MCP tools.
 */
export declare function orderToolsForPromptCache<T extends {
    name: string;
}>(allTools: readonly T[], configuredAgentTools: readonly unknown[], stableMcpToolNames?: ReadonlySet<string>): T[];
/**
 * Type-only re-export：下游继续用 `agent: OrderedToolsAgent<Session>` 声明类型。
 * `import type` 保证不 pull impl / SDK 到主 chunk。
 */
export type OrderedToolsAgent<TContext = unknown> = OrderedToolsAgentImpl<TContext>;
/**
 * Lazy factory：首次调用时加载 impl chunk（内含 SDK 依赖），之后 O(1) 拿 ctor。
 * caller 必须在 async 上下文，唯一 caller 是 agent-factory.ts:36。
 */
export declare function createOrderedToolsAgent<TContext = unknown>(options: OrderedToolsAgentOptions<TContext>): Promise<OrderedToolsAgent<TContext>>;
//# sourceMappingURL=ordered-tools-agent.d.ts.map