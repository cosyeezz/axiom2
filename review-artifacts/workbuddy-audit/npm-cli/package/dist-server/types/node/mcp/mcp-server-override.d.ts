/**
 * MCP server override 的 async factory shim（standby lazy 化 #107267）。
 *
 * ## 背景
 *
 * 6 个 `Overridden*` 类都 `extends` `@openai/agents` / `@openai/agents-core/_shims`
 * 里的基类。`class X extends Y {}` 是 module-load 时求值——若 Y 走 lazy binding
 * 会崩 `Class extends value undefined is not a constructor`。
 *
 * 解法：**把 subclass 定义整体挪到 `./mcp-server-override-impl.ts`**（保留原 static
 * imports），主入口只做 async factory + `await import()`。rspack 看到 dynamic
 * `import()` 就会把 impl 文件连同它顶层 static import 的 `@openai/agents(-core)`
 * 一起拆到 lazy chunk。standby 期不加载 —— agent-loop / MCP connect 都在 activate
 * 后才走到这里。
 *
 * ## 使用契约
 *
 * caller: `mcp-server-manager.ts` 3 处从 `new OverriddenMCPServer*(...)` 改为
 * `await createOverriddenMCPServerXxx(...)`（都在 async 上下文，改动最小）。
 * 首次调用时 impl chunk 加载并缓存；之后 O(1) 拿 factory。
 *
 * 类型层（`OverriddenMCPServerStdio` 等）通过 `import type` re-export，
 * 依然可以在 caller 里作类型注解，不 pull SDK 到主 chunk。
 */
import type { OverriddenMCPServerSSE, OverriddenMCPServerStdio, OverriddenMCPServerStreamableHttp, OverriddenUnderlyingMCPServerSSE, OverriddenUnderlyingMCPServerStdio, OverriddenUnderlyingMCPServerStreamableHttp } from './mcp-server-override-impl';
export type { OverriddenMCPServerSSE, OverriddenMCPServerStdio, OverriddenMCPServerStreamableHttp, OverriddenUnderlyingMCPServerSSE, OverriddenUnderlyingMCPServerStdio, OverriddenUnderlyingMCPServerStreamableHttp, };
export declare function createOverriddenMCPServerStdio(params: ConstructorParameters<typeof import('./mcp-server-override-impl').OverriddenMCPServerStdio>[0]): Promise<OverriddenMCPServerStdio>;
export declare function createOverriddenMCPServerSSE(params: ConstructorParameters<typeof import('./mcp-server-override-impl').OverriddenMCPServerSSE>[0]): Promise<OverriddenMCPServerSSE>;
export declare function createOverriddenMCPServerStreamableHttp(params: ConstructorParameters<typeof import('./mcp-server-override-impl').OverriddenMCPServerStreamableHttp>[0]): Promise<OverriddenMCPServerStreamableHttp>;
