import type { Session } from '../../vendor/cbc-core/node/index.js';
import { type FileChangeArtifact, type FileChangeSnapshot } from '../tools/file-change-artifact';
import type { FileChangeArtifactPublisher } from '../tools/file-change-artifact-publisher';
/** Only committed tool mutations contribute; never reread a changing workspace. */
export declare class TurnDiff {
    private readonly files;
    private bytes;
    private patchBytes;
    commit(snapshot: FileChangeSnapshot): FileChangeArtifact;
    current(): FileChangeArtifact;
}
/** The Server's existing query scope owns the accumulator and its release. */
export declare class ServerFileChangePublisher implements FileChangeArtifactPublisher {
    private readonly turns;
    shouldCapture(): boolean;
    publishPrepared(): Promise<void>;
    begin(session: Session, runId: string, publish: (diff: FileChangeArtifact) => void, recovery?: boolean): () => void;
    committedChanges(session: Session, runId: string): FileChangeArtifact['changes'] | undefined;
    captureMutation(session: Session, snapshot: FileChangeSnapshot): () => void;
}
