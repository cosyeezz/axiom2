import type { AuthoredModRun } from './authored-mod-protocol';
import type { AuthoredModStore } from './authored-mod-store';
/** Bounds browser activation waits without owning plugin execution or accepting stale page results. */
export declare class ModClientRunMonitor {
    private readonly store;
    private readonly changed;
    private readonly deadlineMs;
    private readonly waiting;
    constructor(store: AuthoredModStore, changed: (sessionId: string, pluginId: string, run: AuthoredModRun) => void, deadlineMs?: number);
    watch(id: string, run: AuthoredModRun): void;
    release(id: string, runId?: string): void;
    disconnect(connectionId: string): void;
    private fail;
    close(): void;
}
