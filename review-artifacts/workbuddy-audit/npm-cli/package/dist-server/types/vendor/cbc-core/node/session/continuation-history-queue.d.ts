import type { Session } from './session-protocol';
export declare function registerContinuationWrite(session: Session, marker: unknown, write: () => Promise<void>): void;
/** Run the write registered for this carrier, if any. Returns whether one was found. */
export declare function flushContinuationWriteFor(session: Session, marker: unknown): Promise<boolean>;
/** Drain whatever the stream consumer never saw (abort / early stream end). */
export declare function flushPendingContinuationWrites(session: Session): Promise<void>;
//# sourceMappingURL=continuation-history-queue.d.ts.map