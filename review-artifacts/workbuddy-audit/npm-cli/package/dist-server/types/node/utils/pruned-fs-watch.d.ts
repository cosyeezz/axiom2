/**
 * Pruned recursive filesystem watcher.
 *
 * Shared primitive extracted from `hooks/watch-paths.ts` so any caller that
 * needs to recursively watch an arbitrary directory (hook watchPaths, the
 * Web UI's `/api/v1/fs/watch` gateway API, …) gets the same inotify-safe
 * behaviour instead of re-implementing it (or, worse, calling raw
 * `fs.watch(dir, { recursive: true })` directly).
 *
 * ── Why this exists (ENOSPC / event-loop-starvation bug) ────────────────
 * On Linux, `fs.watch(dir, { recursive: true })` is **not** a native kernel
 * feature — Node simulates it in pure JS (`internal/fs/recursive_watch`) by
 * mounting one inotify watch per **file** it finds while walking the whole
 * subtree, with no exclusion and no cap. Pointed at a real project root
 * (containing `node_modules`, `.git`, build output, …) this can mount
 * hundreds of thousands of inotify watches, exhausting
 * `fs.inotify.max_user_watches` (ENOSPC) and burying the event loop under a
 * flood of watch callbacks (string ops + GC) — symptoms: high RSS, pegged
 * CPU on the main thread, and requests that hang because the event loop
 * never gets a chance to service them.
 *
 * - **Linux (inotify)**: no exclusion hook in the native recursive
 *   implementation, so we do it ourselves: walk the tree manually and mount
 *   **non-recursive** per-directory watches, skipping ignored subtrees
 *   (`node_modules`, `.git`, `dist`, …) entirely at mount time — they never
 *   get a single inotify watch. Watch count becomes "business directory
 *   count", not "total file count". Also capped (`maxWatches`) and
 *   ENOSPC-safe (stops mounting further watches instead of throwing/crashing
 *   the process).
 * - **macOS (FSEvents) / Windows (ReadDirectoryChangesW)**: the kernel
 *   watches the whole tree with a *single* handle — no per-file cost, no
 *   inotify, no ENOSPC. We keep the efficient native
 *   `{ recursive: true }` there and only filter noisy subtrees at the event
 *   layer (dropping their notifications, since we can't skip mounting them
 *   the same way).
 */
import * as fs from 'fs';
/** Mount-time exclusion list: hit means the whole subtree is skipped. */
export declare const DEFAULT_IGNORED_WATCH_DIRS: Set<string>;
/** Watch-count hard cap (Linux manual recursion only) — protects against
 * pathologically large trees even after exclusion. */
export declare const DEFAULT_MAX_WATCHES = 10000;
/** inotify is Linux-specific; only Linux needs manual per-directory mounting. */
export declare const IS_LINUX: boolean;
export interface PrunedWatchOptions {
    /** Directory basenames to never mount a watch under. Defaults to {@link DEFAULT_IGNORED_WATCH_DIRS}. */
    ignoredDirNames?: Set<string>;
    /** Hard cap on directory watch count (Linux manual recursion only). Defaults to {@link DEFAULT_MAX_WATCHES}. */
    maxWatches?: number;
    logger?: {
        debug?: (msg: string) => void;
        warn?: (msg: string) => void;
    };
    /** 任一底层 watcher 挂载失败或运行中报错时回调（`where` 为出错的目录）。 */
    onError?: (err: NodeJS.ErrnoException, where: string) => void;
}
export interface PrunedWatchHandle {
    /** Current number of underlying watch handles installed. */
    readonly watcherCount: number;
    /**
     * True when coverage is incomplete (root not watchable, ENOSPC, watch cap
     * hit, or a watcher errored): callers that rely on events for correctness
     * must fall back to rescanning.
     */
    readonly degraded: boolean;
    /** Close every underlying watcher. Idempotent. */
    close(): void;
}
/**
 * Recursively watch `rootDir`, applying the exclusion/cap/ENOSPC rules
 * described above. `onEvent` receives the raw `fs.WatchEventType` ('rename'
 * | 'change') plus the changed file's absolute path — callers decide how to
 * map that to their own event vocabulary (add/unlink/change, etc.).
 *
 * The root itself is always watched regardless of its own name (exclusion
 * only applies to subdirectories found while walking).
 */
export declare function createPrunedRecursiveWatcher(rootDir: string, onEvent: (eventType: fs.WatchEventType, absPath: string) => void, options?: PrunedWatchOptions): PrunedWatchHandle;
