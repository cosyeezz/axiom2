import type { CreateSessionOptions, SessionKey } from './types';
/** Ensure durable session identity exists without starting an Agent or writing messages. */
export declare function createSession(session: string | SessionKey, options?: CreateSessionOptions): Promise<void>;
