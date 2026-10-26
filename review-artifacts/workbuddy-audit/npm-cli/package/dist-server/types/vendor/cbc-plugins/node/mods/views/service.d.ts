import { type JsonObject } from '../../../../cbc-worker/node/protocol/index.js';
import { type CompiledViewMod, MOD_VIEW_LIMITS, type ModViewAction, type ModViewCatalogIssue, type ModViewCreate, type ModViewEvent, type ModViewMod, type ModViewSnapshot, type ModViewState, type ModViewViewport } from './protocol';
export { ModViewError, requireViewRecord, requireViewString } from './request-contract';
export interface ModViewCatalog {
    list(sessionId: string): Promise<ModViewMod[]>;
    compile(sessionId: string, selections: ModViewCreate['mods'], signal: AbortSignal): Promise<CompiledViewMod[]>;
    session(sessionId: string): Promise<{
        cwd: string;
        signal?: AbortSignal;
    }>;
    validate?(sessionId: string, selections: ModViewCreate['mods'], props: JsonObject): Promise<void>;
    issues?(sessionId: string): Promise<ModViewCatalogIssue[]>;
    loadState?(sessionId: string, keys: string[]): Promise<ModViewState>;
    saveState?(sessionId: string, changes: ModViewState, signal?: AbortSignal): Promise<ModViewState>;
    validateState?(mods: CompiledViewMod[], state: Record<string, JsonObject[]>): Promise<void>;
    validateProps?(mods: CompiledViewMod[], props: Record<string, JsonObject[]>): Promise<void>;
    validateRuntime?(mods: CompiledViewMod[]): Promise<void>;
}
export declare function parseViewViewport(value: unknown): ModViewViewport;
/** One owner for revisions, actions and lifetime; neither HTTP nor ACP owns view state. */
export declare class ModViewService {
    private readonly catalog;
    private readonly operationMs;
    private readonly views;
    private reaper?;
    private disposed;
    constructor(catalog: ModViewCatalog, operationMs?: 15000);
    catalogFor(sessionId: string): Promise<{
        mods: ModViewMod[];
        errors: ModViewCatalogIssue[];
        limits: typeof MOD_VIEW_LIMITS;
    }>;
    create(request: unknown, signal?: AbortSignal, catalog?: ModViewCatalog): Promise<ModViewSnapshot>;
    list(sessionId: string): ModViewSnapshot[];
    get(id: string, sessionId: string): ModViewSnapshot;
    refresh(id: string, sessionId: string): Promise<ModViewSnapshot>;
    patch(id: string, sessionId: string, request: unknown): Promise<ModViewSnapshot>;
    /** Host composition already validates its parent revision; child timers share this same queue. */
    patchCurrent(id: string, sessionId: string, props: JsonObject, viewport: ModViewViewport): Promise<ModViewSnapshot>;
    /** Host-only dispatch by the displayed control identity, resolved atomically with timer updates. */
    actionCurrent(id: string, sessionId: string, displayed: ModViewAction, value: unknown): Promise<ModViewSnapshot>;
    private patchEntry;
    private actionEntry;
    action(id: string, sessionId: string, request: unknown): Promise<ModViewSnapshot>;
    subscribe(id: string, sessionId: string, after: number | undefined, listener: (event: ModViewEvent) => void): () => void;
    delete(id: string, sessionId: string): Promise<void>;
    retireComponent(id: string): Promise<void>;
    close(): Promise<void>;
    private owned;
    private assertOpen;
    private requireRevision;
    private enqueue;
    private runTimer;
    private call;
    private publish;
    private stateValues;
    private acceptsStateKey;
    private syncState;
    private markFailed;
    private emit;
    private retire;
    private disposeEntry;
    private startReaper;
    private abortable;
}
//# sourceMappingURL=service.d.ts.map