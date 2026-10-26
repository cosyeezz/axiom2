import { type Session } from '../../../cbc-core/node/index.js';
/**
 * Wraps a worker → host request handler so it runs inside `rootScope.run(session, …)`:
 * session-aware services (dataFs, settings, MCP, …) then resolve the session the request
 * belongs to instead of whatever the ambient scope happens to be. The REPL bridge calls and
 * the hooks `op.call` both go through here; `resolve` maps the request payload to its session.
 */
export declare function inSession<P, R>(resolve: (payload: P) => Session | undefined, handler: (payload: P, session: Session) => Promise<R>): (payload: P) => Promise<R>;
//# sourceMappingURL=session-scope.d.ts.map