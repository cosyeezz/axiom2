import { type RequestOwner, type RequestRecoveryTarget, type Session } from '../../vendor/cbc-core/node/index.js';
import type { SessionManagerApi } from './services';
import type { QueryTerminal, StopReason } from './types';
export interface RecoveryAdmission {
    expectedRequestId: string;
    receipt: {
        promise: Promise<{
            messageId: string;
        }>;
        resolve(value: {
            messageId: string;
        }): void;
        reject(error: unknown): void;
    };
    target?: RequestRecoveryTarget;
}
export declare function createRecoveryAdmission(expectedRequestId: string): RecoveryAdmission;
/** Called under the kernel's idle admission, before agent resolution or model dispatch. */
export declare function admitRecovery(session: Session, manager: SessionManagerApi, recovery: RecoveryAdmission): Promise<void>;
export declare function rejectUnadmittedRecovery(recovery: RecoveryAdmission, error?: unknown): void;
/**
 * Persist the authoritative attempt outcome after all transcript writers drain.
 * An abort whose reason names a public error (see codeBuddyErrorOfAbortReason)
 * settles as that error rather than as a cancellation.
 */
export declare function commitRequestTerminal(session: Session, manager: SessionManagerApi, requestId: string, attempt: number, stopReason: StopReason, failure?: unknown, abortReason?: unknown, termination?: RequestOwner['termination'], finishReason?: string): Promise<QueryTerminal>;
