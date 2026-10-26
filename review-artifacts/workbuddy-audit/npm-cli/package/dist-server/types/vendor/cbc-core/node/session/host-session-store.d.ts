import type { SessionStore } from './session-store-contract';
/** Existing namespace used by start({ sessionStore }) when projectKey is omitted. */
export declare function defaultHostProjectKey(cwd: string): string;
export declare function registerHostSessionStore(value: SessionStore | undefined): void;
export declare function bindHostProjectKey(sessionId: string, projectKey: string | undefined): void;
export declare function hostSessionBinding(sessionId: string): {
    store: SessionStore;
    projectKey: string;
} | undefined;
//# sourceMappingURL=host-session-store.d.ts.map