/** Rules that change while background work holds the sandbox; never a reason to run unsandboxed. */
export declare class SandboxPolicyBusyError extends Error {
}
interface ComponentOptions<T> {
    initialize?: (instance: T) => void;
    dispose?: (instance: T) => void | Promise<void>;
    disposalOrder?: number;
    isBusy?: (instance: T) => boolean;
}
/** Mutable sandbox components belong to one execution owner, including IPC callbacks. */
export declare class SandboxExecution {
    private readonly instances;
    private readonly finalizers;
    private closing?;
    private closed;
    private disposing;
    private readonly busyChecks;
    private readonly tasks;
    private policy;
    private appliedPolicy;
    get sandboxEnabled(): boolean | undefined;
    get uid(): string | undefined;
    configure(policy: {
        enabled?: boolean;
        uid?: string;
    }): void;
    trackTask(id: string, active: boolean): void;
    isBusy(): boolean;
    /** An unchanged policy keeps its grants while background work is alive. */
    admitPolicy(policy: string): boolean;
    run<A>(body: () => A): A;
    bind<A extends unknown[], B>(fn: (...args: A) => B): (...args: A) => B;
    get<T extends object>(key: object, create: () => T, options: ComponentOptions<T>): T;
    close(): Promise<void>;
}
export declare function currentSandboxExecution(): SandboxExecution | undefined;
export declare function setSandboxUnavailablePolicy(policy: 'fail' | 'local' | undefined): void;
/**
 * A server turn whose sandbox cannot start fails, so the session never runs
 * outside the sandbox it asked for, unless the Host chose local execution as
 * the CLI does. The CLI itself never enters a scope and never fails closed.
 */
export declare function sandboxFailsClosed(): boolean;
/**
 * A stable DI reference, with one freshly constructed instance per execution.
 * Dependencies are injected by the usual Layer; no mutable instance is copied.
 * Callback arguments are bound to the owner, so shared event emitters cannot
 * move a reverse RPC or disconnect notification into another session's scope.
 */
export declare function sandboxComponent<T extends object>(create: () => T, deferInitialize: (body: () => void) => void, options?: ComponentOptions<T>): T;
export {};
