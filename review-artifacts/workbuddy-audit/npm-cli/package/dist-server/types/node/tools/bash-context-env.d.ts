/** 子进程上下文所需的 session 字段。 */
export interface ChildContextSessionSnapshotSource {
    id?: string;
    conversationRequestId?: string;
    messageId?: string;
    options?: {
        mcpConfig?: string;
    };
    /**
     * Session-scoped metadata. Only `rootRequestId` is consumed here (projected
     * as `CODEBUDDY_ROOT_REQUEST_ID`); other keys are ignored to avoid coupling
     * child-process env to arbitrary in-memory session state.
     */
    meta?: {
        rootRequestId?: string;
    };
}
/** @deprecated Use {@link ChildContextSessionSnapshotSource}. */
export type BashContextSessionSnapshotSource = ChildContextSessionSnapshotSource;
export interface BuildChildContextEnvOptions {
    /** Inherited process environment. Stale request fields are removed before overlays are applied. */
    baseEnv?: Readonly<Record<string, string | undefined>>;
    /** Caller-owned values such as PATH, safe-delete state, and service proxy configuration. */
    env?: Readonly<Record<string, string | undefined>>;
    projectDir?: string;
    /**
     * Session snapshot used wholesale: when provided, ambient turn state never
     * fills individual missing fields (a partial snapshot must not mix with a
     * different session's live turn). Omitted means read the live turn scope.
     */
    session?: ChildContextSessionSnapshotSource;
    model?: string;
    /**
     * Explicit W3C carrier for deterministic callers/tests. `{}` means "no
     * propagation"; omitted means read the live turn scope at spawn time.
     */
    carrier?: Readonly<Record<string, unknown>>;
    platform?: NodeJS.Platform;
}
/**
 * Build the complete environment for a request-scoped child process.
 *
 * Inherited request identifiers are removed first so an invocation outside a
 * turn cannot accidentally reuse its parent's trace. Caller-owned overlays are
 * then applied, followed by the authoritative session snapshot and live W3C
 * carrier captured at the spawn boundary.
 */
export declare function buildChildContextEnv(options?: BuildChildContextEnvOptions): Record<string, string>;
/**
 * Backward-compatible positional facade. New execution paths should call
 * {@link buildChildContextEnv} so their inherited environment is scrubbed too.
 */
export declare function buildBashContextEnv(projectDir: string, sessionId?: string, conversationRequestId?: string, mcpConfig?: string, model?: string, conversationMessageId?: string): Record<string, string>;
/** Backward-compatible session-only snapshot; spawn boundaries add the live carrier. */
export declare function buildSessionBashContextEnv(projectDir: string, session: ChildContextSessionSnapshotSource, model?: string): Record<string, string>;
export declare function buildBashHostConfigEnv(processEnv?: Record<string, string | undefined>): Record<string, string>;
export declare function setDocumentEnvironment(session: object, address: string, token: string, turn: {
    closed: boolean;
}): void;
/** Document scripts log this reason and continue editing or saving without a rollback guarantee. */
export declare function setDocumentBackupError(session: object, error: string): void;
export declare function clearDocumentBackupError(session: object): void;
