import type { ReadSessionOptions, SessionKey, SessionSnapshot } from './types';
/** Read a durable conversation without starting or resuming an Agent runtime. */
export declare function readSession(session: string | SessionKey, options?: ReadSessionOptions): Promise<SessionSnapshot | null>;
