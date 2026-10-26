/** zod schema 需调用方先 `await preloadZodToJsonSchema()`，否则按无法计算返回 `undefined`。 */
export declare function fingerprintToolInputSchema(schema: unknown): string | undefined;
