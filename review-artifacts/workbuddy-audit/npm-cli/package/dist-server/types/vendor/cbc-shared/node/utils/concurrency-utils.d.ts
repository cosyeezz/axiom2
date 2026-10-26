/**
 * Map items with a bounded number of async workers while preserving input
 * order in the returned results.
 */
export declare function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=concurrency-utils.d.ts.map