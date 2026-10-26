import { type ReadSessionOptions, type RewindOptions, type RewindResult } from './types';
/** Caller owns execution exclusion. The existing fork notice is the durable commit. */
export declare function rewindSessionHistory(sessionId: string, options: RewindOptions & Pick<ReadSessionOptions, 'sessionStore' | 'projectKey'>): Promise<RewindResult>;
