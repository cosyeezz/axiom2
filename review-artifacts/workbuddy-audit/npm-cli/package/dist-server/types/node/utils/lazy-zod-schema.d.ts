/**
 * zod-to-json-schema 惰性装载：主 chunk 199 KB → lazy chunk。
 *
 * ## 为什么值得拆
 *
 * lite-wb prewarm standby 期不实例化 ToolManager 也不 execute tools，因此
 * `zodToJsonSchema` 完全用不到。但 module top-level `import { zodToJsonSchema }
 * from 'zod-to-json-schema'` 让 rspack 静态拉进主 chunk 199 KB。
 *
 * ## 契约
 *
 * 同款：先 `await preloadZodToJsonSchema()` 再同步 `getZodToJsonSchema()(schema)`。
 * 所有 caller 位于 async 上下文（tool.execute 一族、tool-manager.get() /
 * indexDeferredTool、context/model-based-token-calculator、repl catalog）。
 */
import type zodToJsonSchemaFn from 'zod-to-json-schema';
type ZodToJsonSchemaModule = {
    zodToJsonSchema: typeof zodToJsonSchemaFn;
};
export declare function preloadZodToJsonSchema(): Promise<ZodToJsonSchemaModule>;
/**
 * 同步取 zodToJsonSchema。**必须**先 `await preloadZodToJsonSchema()`。
 * caller 保证在 async 上下文首行 preload 后再深层同步用本 API。
 */
export declare function getZodToJsonSchema(): typeof zodToJsonSchemaFn;
export {};
