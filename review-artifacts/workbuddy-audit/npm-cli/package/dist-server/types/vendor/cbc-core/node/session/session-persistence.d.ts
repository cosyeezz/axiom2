import type { Session } from './session-protocol';
/**
 * Allow one explicit Resource API mutation to write an existing durable
 * session even when the hosting process uses --no-session-persistence.
 *
 * This deliberately overrides only the process-level launch policy. A
 * session whose own persistence option is false remains ephemeral.
 */
export declare function runExplicitDurableSessionMutation<T>(mutation: () => T): T;
/**
 * Session persistence is a process-level CLI policy, with a session-level
 * equivalent for requests created through ACP or the SDK.
 *
 * Read paths intentionally do not use this policy: an ephemeral process may
 * inspect or resume an existing transcript. Ordinary runtime writes remain
 * suppressed; only an explicitly scoped Resource API mutation may override
 * the process-level policy for an existing durable session.
 */
export declare function isSessionPersistenceDisabled(session?: Pick<Session, 'options'>, argv?: readonly string[]): boolean;
//# sourceMappingURL=session-persistence.d.ts.map