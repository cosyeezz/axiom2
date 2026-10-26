import type { Session } from '../../vendor/cbc-core/node/index.js';
/** `undefined` returns the session to the inline limit. */
export declare function setSessionMcpConnectTimeoutMs(session: Session, ms: number | undefined): void;
/**
 * How long a server the session starts in its execution environment has to
 * connect: the session's value, else `undefined`, which leaves the inline
 * limit (`McpUtils.getInlineMcpConnectTimeout`).
 */
export declare function resolveSessionMcpConnectTimeoutMs(session: Session | undefined): number | undefined;
