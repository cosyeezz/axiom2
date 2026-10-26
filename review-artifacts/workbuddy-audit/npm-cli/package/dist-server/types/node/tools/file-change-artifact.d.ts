/** File operations that can be represented from one before/after snapshot pair. */
export type FileChangeOperation = 'add' | 'modify' | 'delete';
/**
 * Line/char counts of one file change, measured on the complete before/after
 * snapshots. Chars are UTF-16 code units including line terminators.
 *
 * Unlike `patch`, statistics do not depend on the patch budgets, so hosts can
 * still render `+N -N` when the renderable patch is omitted (#134426).
 */
export interface FileChangeLineStats {
    addedLines: number;
    removedLines: number;
    addedChars: number;
    removedChars: number;
}
/**
 * Why a change carries no usable preimage backup. The three reasons must stay
 * distinguishable for hosts (#156509): "not needed" is not "failed to write".
 *
 * - `checkpoint-disabled`: checkpointing is off for this session (setting, env
 *   kill-switch, sub-agent, persistence disabled).
 * - `not-applicable`: there is no preimage to back up (new file, symlink,
 *   directory, internal index file).
 * - `missing`: a backup was expected but is not on disk.
 */
export type FileChangeBackupUnavailableReason = 'checkpoint-disabled' | 'not-applicable' | 'missing';
/**
 * Locates the "before" content of one change inside the session's checkpoint
 * store (`{configDir}/file-history/{sessionId}/{fileName}`). The frame names only
 * the file, never an absolute path, so `configDir` does not leak to hosts.
 *
 * `existedAtTrack` mirrors the checkpoint's own fact of whether the file existed
 * when it was first tracked. Hosts must not treat "backup unavailable" as "file
 * did not exist": only `existedAtTrack === false` means the latter.
 */
export type FileChangeBackup = {
    fileName: string;
    version: number;
    existedAtTrack?: boolean;
} | {
    reason: FileChangeBackupUnavailableReason;
    existedAtTrack?: boolean;
};
/** Protocol-neutral file metadata. `path` is always an absolute filesystem path. */
export interface FileChange {
    operation: FileChangeOperation;
    path: string;
    fileType?: string | null;
    mimeType?: string | null;
    stats?: FileChangeLineStats;
    backup?: FileChangeBackup;
}
/** A renderable patch attached to a file-change artifact. */
export interface FileChangePatch {
    format: 'git_patch';
    text: string;
}
/**
 * Tool-owned file-change data. Consumers may project this into ACP or another
 * transport without making the patch builder depend on that transport.
 */
export interface FileChangeArtifact {
    changes: FileChange[];
    patch: FileChangePatch | null;
}
/**
 * The authoritative before/after plan captured after final path/input rewrites
 * and immediately before a file tool performs its mutation. Successful tool
 * results may persist the same artifact for terminal updates and replay.
 *
 * `snapshotsComplete` must only be true when `oldText` and `newText` describe
 * the complete file states, rather than search/replacement fragments.
 */
export interface FileChangeSnapshot extends FileChange {
    oldText: string | null;
    newText: string | null;
    snapshotsComplete: boolean;
}
export interface FileChangeArtifactBuildOptions {
    /** Maximum number of file changes represented by one logical artifact. */
    maxFiles: number;
    /** Tool cards retain legacy stats; turn diffs derive counts from their patch. */
    includeStats: boolean;
    /** Combined UTF-8 byte budget for all before/after snapshots. */
    maxInputBytes: number;
    /** UTF-8 byte budget for either side of one file snapshot. */
    maxFileSnapshotBytes: number;
    /** Fine-diff line budget after trimming; larger regions use a coarse hunk. */
    maxInputLines: number;
    /** UTF-8 byte budget for JSON-encoded patch text, leaving room for its RPC envelope. */
    maxPatchBytes: number;
    /**
     * Cooperative elapsed-time budget, not a hard wall-clock deadline.
     * jsdiff checks time between edit-distance iterations; tokenization, one
     * iteration, patch formatting and validation cannot be preempted. This
     * synchronous API may block its caller beyond the budget. Hosts requiring
     * isolation must run it off their UI/event-loop thread.
     */
    timeoutMs: number;
    /** Number of unchanged lines around each hunk. */
    contextLines: number;
}
export declare const DEFAULT_FILE_CHANGE_ARTIFACT_BUILD_OPTIONS: Readonly<FileChangeArtifactBuildOptions>;
/**
 * Validate a persisted patch against its authoritative change manifest.
 *
 * `diff` validates hunk syntax and decodes Git's quoted file headers; the
 * explicit `diff --git` checks additionally prevent a syntactically valid
 * unified diff from claiming a different path or operation on replay.
 */
export declare function validateFileChangePatch(changes: readonly FileChange[], patchText: string): boolean;
/**
 * Builds authoritative `changes` plus an optional, all-or-nothing Git patch.
 *
 * The patch is intentionally omitted when any input is unsafe or cannot be
 * represented within the configured budgets. This keeps a multi-file patch
 * from silently describing only a subset of its authoritative `changes`.
 */
export declare function buildFileChangeArtifact(snapshots: readonly FileChangeSnapshot[], options?: Partial<FileChangeArtifactBuildOptions>): FileChangeArtifact;
export declare function parsePersistedFileChangeArtifact(value: unknown): FileChangeArtifact | undefined;
