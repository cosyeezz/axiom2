/** Optional host startup trace; no collector, timers or context when disabled. */
export declare function measureStartup<A>(phase: string, operation: () => A): A;
