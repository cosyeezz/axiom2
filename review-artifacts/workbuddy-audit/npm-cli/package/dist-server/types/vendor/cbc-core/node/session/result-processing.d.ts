import type { Session } from './session-protocol';
/** RxJS does not await async subscribers. Retain their full bookkeeping lifetime. */
export declare function observeSessionResult(session: Session, handle: (result: Session['resultSubject']['value']) => Promise<void>, onError: (error: unknown) => void): (result: Session['resultSubject']['value']) => void;
/** Producers must be stopped first. No argument drains all sessions before runtime release. */
export declare function drainSessionResults(session?: Session): Promise<void>;
//# sourceMappingURL=result-processing.d.ts.map