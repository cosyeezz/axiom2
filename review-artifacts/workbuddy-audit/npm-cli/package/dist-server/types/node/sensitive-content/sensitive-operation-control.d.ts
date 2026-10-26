export declare class SensitiveOperationCancelledError extends Error {
    constructor();
}
export declare function awaitSensitiveOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T>;
