/** Internal operation lifetime. CLI callers without a host keep their usual lifetime. */
export interface PluginOperation {
    readonly signal: AbortSignal;
    readonly isCurrent?: () => boolean;
    /** The host serializes local publication; network preparation never enters here. */
    readonly commit?: <A>(run: () => Promise<A>) => Promise<A>;
    readonly committing?: boolean;
}
export declare function withPluginOperation<A>(operation: PluginOperation, run: () => Promise<A>): Promise<A>;
export declare function pluginOperationSignal(): AbortSignal | undefined;
/** Check again after preparation/lock acquisition, before publishing shared state. */
export declare function assertPluginOperationCurrent(afterLock?: boolean): void;
/** Nested storage operations share the same commit; a started publication must settle. */
export declare function withPluginCommit<A>(run: () => Promise<A>): Promise<A>;
//# sourceMappingURL=plugin-operation.d.ts.map