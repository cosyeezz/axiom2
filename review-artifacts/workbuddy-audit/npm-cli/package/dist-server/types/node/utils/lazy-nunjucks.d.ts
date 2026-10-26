/**
 * nunjucks 真·惰性装载：主 chunk 176 KB → lazy chunk。
 *
 * ## Standby 期不加载的证据
 *
 * nunjucks 顶层业务 importer：
 *   - `agent/plugin-agent-compose.ts` — `composePluginAgent()` 内 nunjucks 模板 eval
 *     插件 agent conditional。只在 activate 后 agent-manager 里
 *     `applyPluginAgentSetting` 走 (async chain)
 *   - `../prompts/lib/common/default-prompt-renderer.js`（@genie/prompts 深链）
 *     — 待另行审计（可能来自 template 渲染 heavy 桶）
 *
 * standby 期无 agent-manager rebuild / prompt render，nunjucks 完全冷代码。
 */
type NunjucksModule = typeof import('nunjucks');
export declare function preloadNunjucks(): Promise<NunjucksModule>;
export declare function getNunjucks(): NunjucksModule;
export {};
