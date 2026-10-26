import { Application, ApplicationLifecycle } from '@celljs/core';
import { ReadFileStateService } from './tool-protocol';
/**
 * Read-before-edit ledger. The ledger is conversation state — which files THIS
 * session has read, and the mtime it saw — so each session resolved through
 * the run-scope seam owns its own map, keyed by session identity and collected
 * with it. The process-level map only backs contexts with no resolvable
 * session (bin single-session modes) and keeps the legacy
 * reset-on-session-switch semantics.
 *
 * File freshness goes through statPath, so a mounted sandbox answers before
 * the host filesystem; sandbox stats missing mtime degrade to epoch, which
 * this guard reads as never-modified.
 */
export declare class ReadFileStateServiceImpl implements ReadFileStateService, ApplicationLifecycle<Application> {
    private readonly sessionLedgers;
    private readonly processLedger;
    initialize(): void;
    readFile(filePath: string, fileStats: {
        mtime: Date;
    }): void;
    hasBeenRead(filePath: string): boolean;
    hasBeenModifiedSinceLastRead(filePath: string): Promise<boolean>;
    refreshFile(filePath: string): Promise<void>;
    private scope;
    private normalize;
}
