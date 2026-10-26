export declare function mapWithConcurrencyLimit<T, R>(items: readonly T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]>;
//# sourceMappingURL=concurrency.d.ts.map