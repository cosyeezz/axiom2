/**
 * undici 真·惰性装载：主 chunk 里 889 KB 源码（含 http/websocket/fetch 等），
 * standby 期完全不 parse。
 *
 * ## 惰性契约（与 lazy-encoding.ts 同款）
 *
 * 使用姿势：**先 `await preloadUndici()`，之后 `getUndici()` 同步取模块**。
 *
 * 之所以不用 `require('undici')`：rspack 会把 `require(literal)` 识别成静态依赖，
 * 无论逻辑上多"惰性"，包体一定进主 chunk。真·lazy 只能走 dynamic `import()`。
 * fetch-proxy.ts 和 mcp-utils.ts 原本用的 `require()` 就是这个坑（见基线归因：
 * 主 chunk 里 96 个 undici module，standby 完全用不到）。
 *
 * ## Standby 期不加载的证据
 *
 * undici 顶层业务 importer：
 *   - `utils/mcp-utils.ts` — `McpUtils.getToolFetch()`：MCP HTTP/SSE transport
 *     绑定 dispatcher；activate 后 MCP connect 才调
 *   - `http/fetch-proxy.ts` — `getUndiciFetch()` / ProxyAgent：只有真正 fetch
 *     发生时才走到，standby `initialize()` 只 replace globalThis.fetch，不 evaluate
 *
 * 两个 caller 都在 activate 后才走到 undici 实体，因此拆到 lazy chunk 无副作用。
 */
type UndiciModule = typeof import('undici');
export declare function preloadUndici(): Promise<UndiciModule>;
/**
 * 同步取 undici。**必须**先 `await preloadUndici()`，否则 fail-loud。
 * 不做 sync require 回退：静默回退会让 lazy 优化退化回主 chunk 常驻。
 */
export declare function getUndici(): UndiciModule;
export {};
