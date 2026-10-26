import type { Session, SessionManager, SessionOptions } from '../../vendor/cbc-core/node/index.js';
/** /clear replaces the conversation, not its host or user-selected configuration. */
export declare function clearedSessionOptions(source: Session, manager: SessionManager): SessionOptions;
/** Whitelist settings only: titles, A2A continuation, goals and team roles reset. */
export declare function clearedSessionMeta(source: Session): NonNullable<Session['meta']>;
/** Restore side tables under the new identity before hooks and the first run. */
export declare function inheritClearedSessionOverrides(source: Session, target: Session, manager: SessionManager): void;
