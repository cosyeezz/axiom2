import { Mods } from '../../../vendor/cbc-plugins/node/index.js';
import type { FileLockService } from '../../lock/lock-protocol';
import { type ComponentDefinition, type ComponentLibraryRole, type UserComponent } from './component-protocol';
import type { DiscoveryItem } from './mod-discovery';
interface StateSession {
    id: string;
    signal?: AbortSignal;
}
export declare function componentHash(definition: ComponentDefinition): string;
/** One atomic registry transaction under the existing cross-process file lock. */
export declare class ComponentStore {
    private readonly dir;
    private readonly locks;
    private readonly file;
    private readonly stateFile;
    private readonly sessionState;
    private readonly watchedSessions;
    constructor(dir: string, locks: FileLockService);
    /** Reads never create/reset user data. Legacy format 1 migrates only on a successful write. */
    loadState(keys: string[], session?: StateSession): Promise<Mods.ModViewState>;
    /** A single CAS transaction covers every child in a composition, so partial commits cannot occur. */
    saveState(changes: Mods.ModViewState, session?: StateSession, signal?: AbortSignal): Promise<Mods.ModViewState>;
    private stateForSession;
    private readState;
    list(): Promise<UserComponent[]>;
    summaries(): Promise<DiscoveryItem[]>;
    get(id: string): Promise<UserComponent>;
    saveDraft(id: string, definition: ComponentDefinition, revision?: number, libraryRole?: ComponentLibraryRole): Promise<UserComponent>;
    classify(id: string, revision: number, libraryRole: ComponentLibraryRole): Promise<UserComponent>;
    publish(id: string, revision: number, hash: string): Promise<UserComponent>;
    setEnabled(id: string, revision: number, enabled: boolean): Promise<UserComponent>;
    delete(id: string, revision: number): Promise<void>;
    private recordMetadata;
    private readRecord;
    private readIndex;
    private validateComponents;
    private transaction;
}
export {};
