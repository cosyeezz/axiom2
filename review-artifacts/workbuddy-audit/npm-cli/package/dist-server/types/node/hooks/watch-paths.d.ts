/**
 * Register fs.watch monitors for the paths a SessionStart or Setup hook emitted
 * via `hookSpecificOutput.watchPaths`. On change/add/unlink, invoke the provided
 * callback with (filePath, event).
 *
 * Returns a dispose function that closes every watcher; callers typically stow
 * it on `session.hookContexts.fileWatchersDispose` and invoke it on session end.
 *
 * Exported as a module-level helper so payload-shape / behaviour can be unit
 * tested without instantiating SessionHookManagerImpl. See watch-paths.spec.ts.
 *
 * Directory watching (mount-time exclusion, Linux manual recursion vs. native
 * recursive on macOS/Windows, watch-count cap, ENOSPC handling) is delegated to
 * the shared {@link createPrunedRecursiveWatcher} primitive — see
 * `utils/pruned-fs-watch.ts` for the full per-platform ENOSPC-safety rationale.
 * This module only owns per-file watching and multi-path/dispose orchestration.
 */
export type FileChangeEvent = 'change' | 'add' | 'unlink';
export interface WatchPathsResult {
    /** Number of fs.watch handles successfully installed (dirs + files). */
    watcherCount: number;
    /** Dispose closes every installed watcher (idempotent). */
    dispose: () => void;
}
/**
 * Register watchers for each path. Unexisting paths are silently skipped.
 * Node's fs.watch has limitations (macOS doesn't reliably fire `add`/`unlink`;
 * Linux recursive requires node 16+). We normalise its native events to the
 * Claude Code vocabulary: 'rename' → add/unlink depending on fs.existsSync,
 * 'change' → 'change'.
 *
 * Directory paths are watched via {@link createPrunedRecursiveWatcher}, which
 * handles the per-platform ENOSPC-safety rationale (Linux manual recursion with
 * mount-time exclusion vs. native recursive + event-layer exclusion elsewhere).
 */
export declare function registerWatchPaths(paths: unknown, 
/** 返回 Promise 时会被等待（背压）；其他返回值忽略。 */
onChange: (filePath: string, event: FileChangeEvent) => unknown, options?: {
    logger?: {
        debug?: (msg: string) => void;
        warn?: (msg: string) => void;
    };
    maxWatches?: number;
}): WatchPathsResult;
