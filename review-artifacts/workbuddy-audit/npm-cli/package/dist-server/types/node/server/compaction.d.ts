import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { SessionEvent } from './types';
/** Per-query observation of the existing manual command, after command/skill resolution. */
export declare class ManualCompactions {
    private readonly runs;
    private readonly operations;
    own(session: Session, id: string): () => void;
    owns(session: Session, id: string): boolean;
    start(session: Session): void;
    track(session: Session, runId: string, publish: (event: SessionEvent) => void): {
        finish: (outcome: {
            aborted: boolean;
            failure?: unknown;
            assistantText: string;
        }, flush: () => Promise<void>) => Promise<unknown | undefined>;
        close: () => void;
    };
}
