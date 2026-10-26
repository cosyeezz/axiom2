import { PathResolver } from '@celljs/web';
import { Context, Middleware, RequestMatcher } from '@celljs/web/lib/node';
import { SessionManager } from '../../vendor/cbc-core/node/index.js';
import { Logger } from '@genie/telemetry';
/**
 * Middleware that monitors HTTP connection and aborts session when client disconnects
 *
 * This middleware runs after SessionMiddleware (which creates/loads the session)
 * and sets up a 'close' event listener on the HTTP request to detect client disconnection.
 *
 * When the client disconnects (e.g., closes connection, times out, or crashes),
 * the session's AbortController is triggered to cancel ongoing agent execution.
 */
export declare class SessionAbortMiddleware implements Middleware {
    readonly priority: number;
    protected readonly requestMatcher: RequestMatcher;
    protected readonly pathResolver: PathResolver;
    protected readonly sessionManager: SessionManager;
    protected readonly logger: Logger;
    handle(ctx: Context, next: () => Promise<void>): Promise<void>;
    private canHandle;
}
