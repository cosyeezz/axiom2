export type PromptCacheStability = 'stable' | 'volatile';
export declare function markPromptCacheStability(tool: object, stability: PromptCacheStability): void;
export declare function getPromptCacheStability(tool: unknown): PromptCacheStability | undefined;
export declare function setStableMcpToolNames(server: object, toolNames: Iterable<string>): void;
export declare function getStableMcpToolNames(servers: readonly unknown[]): ReadonlySet<string>;
//# sourceMappingURL=prompt-cache-tool-metadata.d.ts.map