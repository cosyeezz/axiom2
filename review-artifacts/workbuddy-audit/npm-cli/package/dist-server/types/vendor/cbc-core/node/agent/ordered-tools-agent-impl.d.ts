/**
 * OrderedToolsAgent 的 subclass 实现（standby lazy 化 #107267）。
 *
 * `class X extends Agent {}` 是 module-load 时求值——若 `Agent` 走
 * openai-agents-types 的 lazy binding（module load 时未 preload = undefined），
 * 直接 module 加载就崩 `Class extends value undefined is not a constructor`。
 *
 * 解法（对齐 mcp-server-override 的分层）：本文件 static import Agent 类；
 * 主入口 `./ordered-tools-agent.ts` 只 `import type` + async factory，rspack
 * 看到 `await import('./ordered-tools-agent-impl')` 就会把本文件连同顶层
 * static import 的 `@openai/agents(-core)` 一起拆到 lazy chunk。
 *
 * spec 需要访问 class prototype 时直接从本 impl 文件 import
 * `OrderedToolsAgent` class（参考 mcp-server-override.spec.ts 的做法）。
 */
import { Agent, type RunContext, type Tool } from '@openai/agents';
import { type OrderedToolsAgentOptions } from './ordered-tools-agent';
export declare class OrderedToolsAgent<TContext = unknown> extends Agent<TContext, any> {
    private readonly observeRunPhase?;
    constructor(options: OrderedToolsAgentOptions<TContext>);
    getAllTools(runContext: RunContext<TContext>): Promise<Tool<TContext>[]>;
    getSystemPrompt(runContext: RunContext<TContext>): Promise<string | undefined>;
}
//# sourceMappingURL=ordered-tools-agent-impl.d.ts.map