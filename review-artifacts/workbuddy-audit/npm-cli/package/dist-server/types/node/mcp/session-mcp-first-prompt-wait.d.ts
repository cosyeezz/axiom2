import type { Session } from '../../vendor/cbc-core/node/index.js';
/** `undefined` returns the session to the process environment. */
export declare function setSessionMcpFirstPromptWaitMs(session: Session, ms: number | undefined): void;
/**
 * How long the session's first run waits for the MCP servers it starts in its
 * execution environment: the session's value, else
 * `CODEBUDDY_FIRST_RUN_MCP_PREWAIT_TIMEOUT_MS` (2 seconds when unset). 0 does not wait.
 */
export declare function resolveSessionMcpFirstPromptWaitMs(session: Session | undefined): number;
