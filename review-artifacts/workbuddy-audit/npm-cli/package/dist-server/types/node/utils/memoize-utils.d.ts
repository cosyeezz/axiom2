type Func = (...args: any[]) => any;
type AsyncFunc = (...args: any[]) => Promise<any>;
type EqualityFn<TFunc extends Func> = (newArgs: Parameters<TFunc>, lastArgs: Parameters<TFunc>) => boolean;
interface AsyncMemoizeOptions {
    cacheRejection?: boolean;
}
export interface MemoizedValue<TFunc extends Func> {
    readonly value: ReturnType<TFunc> | typeof MemoizeUtils.None;
    update(...args: Parameters<TFunc>): ReturnType<TFunc>;
}
export interface AsyncMemoizedValue<TFunc extends AsyncFunc> {
    readonly value: Awaited<ReturnType<TFunc>> | typeof MemoizeUtils.None;
    readonly promise: ReturnType<TFunc> | typeof MemoizeUtils.None;
    update(...args: Parameters<TFunc>): ReturnType<TFunc>;
}
/**
 * Memoization utilities
 */
export declare class MemoizeUtils {
    static readonly None: Readonly<{}>;
    private static defaultEqualityFn;
    /**
     * Simple memoization function that caches results based on JSON-stringified arguments
     */
    static memoize<T extends (...args: any[]) => any>(fn: T): T;
    static memoizeOne<TFunc extends Func>(fn: TFunc, isEqual?: EqualityFn<TFunc>): MemoizedValue<TFunc>;
    static memoizeOneAsync<TFunc extends AsyncFunc>(fn: TFunc, isEqual?: EqualityFn<TFunc>, options?: AsyncMemoizeOptions): AsyncMemoizedValue<TFunc>;
}
export {};
