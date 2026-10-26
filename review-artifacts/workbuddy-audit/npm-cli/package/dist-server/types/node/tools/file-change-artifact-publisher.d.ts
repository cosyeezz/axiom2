import type { Session } from '../../vendor/cbc-core/node/index.js';
import type { FileChangeArtifact, FileChangeBackup, FileChangeSnapshot } from './file-change-artifact';
/**
 * Optional bridge from a file tool's authoritative pre-write plan to protocol
 * consumers. File tools own the mutation data; transports decide whether a
 * prepared preview is useful for the current session.
 */
export declare const FileChangeArtifactPublisher: unique symbol;
/**
 * Bind file-change artifact work to the protocol owner of the concrete run.
 *
 * This is deliberately process-local and replaceable. A passive observer must
 * not enable diff construction for a WorkBuddy/compatibility run, and a later
 * run on the same Session object must be able to clear an earlier v2 owner.
 */
export declare function setSessionAcpV2FileChangeArtifactOwner(session: Session, canonicalV2Owner: boolean): void;
/** Copy the process-local run owner to a newly created or resumed child. */
export declare function inheritSessionAcpV2FileChangeArtifactOwner(child: Session, parent: Session): void;
export declare function shouldPersistAcpV2FileChangeArtifacts(session: Session): boolean;
export interface FileChangeArtifactPublisherRequest {
    session: Session;
    toolCallId: string;
    toolName: string;
    rawInput?: Record<string, unknown>;
    artifact: FileChangeArtifact;
}
export interface FileChangeCapturePathKind {
    fileType: 'text' | 'directory' | 'symlink' | null;
    patchableText: boolean;
}
/**
 * Classify the exact path entry used by a file tool without following links.
 *
 * The existing tools intentionally keep their historical write path and link
 * following behaviour. ACP presentation, however, must not claim that a link
 * itself is a regular text file or publish a text patch that an IDE could later
 * apply to the link identity. Unknown/special entries therefore remain visible
 * in `changes` but fail closed to `patch: null`.
 */
export declare function inspectFileChangeCapturePath(filePath: string, isNewFile: boolean): Promise<FileChangeCapturePathKind>;
interface RecordedFileChangeBackup {
    backup: FileChangeBackup;
    /** Confirms the referenced backup still equals the file's bytes at write time. */
    isCurrent?: (absolutePath: string) => Promise<boolean>;
}
export declare function recordFileChangeBackup(toolCall: object, recorded: RecordedFileChangeBackup): void;
/**
 * Resolve the `backup` of the change a file tool is about to write.
 *
 * Returns `undefined` when no pre-write step ran for this call (the tool was executed
 * outside ToolManager), so the field is omitted rather than guessed. A non-regular path or
 * a newly created file has no preimage, whatever the checkpoint recorded. A reference is
 * only emitted when the backup is verified to equal the bytes the tool is about to
 * overwrite; a concurrent writer between backup and write degrades it to `missing`
 * instead of pointing the host at the wrong preimage.
 */
export declare function resolveFileChangeBackup(toolCall: object | undefined, capture: {
    absolutePath: string;
    isNewFile: boolean;
    fileType: FileChangeCapturePathKind['fileType'];
}): Promise<FileChangeBackup | undefined>;
export interface FileChangeToolPresentation {
    name: 'Write' | 'Edit' | 'MultiEdit';
    title: string;
    kind: 'edit';
}
/** Describe the three file tools from the artifact's final execution path. */
export declare function createFileChangeToolPresentation(toolName: unknown, artifact: FileChangeArtifact): FileChangeToolPresentation | undefined;
export interface PreparedAcpV2FileChange {
    artifact: FileChangeArtifact;
    rawInput?: Record<string, unknown>;
}
/** Remember the exact prepared projection for a later live failed result. */
export declare function rememberPreparedAcpV2FileChange(request: FileChangeArtifactPublisherRequest): void;
/** Read a detached live projection without consuming it for other observers. */
export declare function readPreparedAcpV2FileChange(sessionId: string, toolCallId: string): PreparedAcpV2FileChange | undefined;
/**
 * Remove and tombstone a denied result. The tombstone also defeats a delayed
 * fire-and-forget publisher, so sensitive plaintext cannot be reintroduced
 * after history admission has failed closed.
 */
export declare function withholdPreparedAcpV2FileChange(session: Session, toolCallId: string): void;
export declare const MAX_FILE_CHANGE_RAW_INPUT_BYTES: number;
/** Return a detached, JSON-safe tool input only when it fits the wire/history budget. */
export declare function createBoundedFileChangeRawInput(value: unknown): Record<string, unknown> | undefined;
export interface FileChangeArtifactPublisher {
    /** Capture the turn owner before I/O; invoke only after the mutation commits. */
    captureMutation?(session: Session, snapshot: FileChangeSnapshot): () => void;
    /** Avoid diff work when no canonical consumer can observe the artifact. */
    shouldCapture(session: Session): boolean;
    /**
     * Schedule the prepared artifact before the corresponding mutation starts.
     * The caller does not wait for transport delivery: presentation latency or
     * failure must never delay or fail a validated file operation.
     */
    publishPrepared(request: FileChangeArtifactPublisherRequest): Promise<void>;
}
export interface LiveFileChangeProjection {
    artifact: FileChangeArtifact;
    rawInput?: Record<string, unknown>;
}
export declare function rememberLiveFileChangeProjection(item: object, artifact: FileChangeArtifact, rawInput?: Record<string, unknown>): void;
export declare function readLiveFileChangeProjection(item: object): LiveFileChangeProjection | undefined;
export declare function clearLiveFileChangeProjection(item: object): void;
export declare function parsePersistedFileChangeRawInput(value: unknown): Record<string, unknown> | undefined;
export {};
