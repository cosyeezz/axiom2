import type { Session } from './session-protocol';
export declare function isSessionRuntimeClosed(session: Session): boolean;
export declare function closeSessionRuntime(session: Session): void;
export declare function sessionRuntimeSignal(session: Session): AbortSignal;
export declare function assertSessionRuntimeOpen(session: Session | undefined): void;
//# sourceMappingURL=session-runtime-lifecycle.d.ts.map