import type { FileLockService } from '../../lock/lock-protocol';
import type { AuthoredMod, AuthoredModDefinition, AuthoredModRun } from './authored-mod-protocol';
import type { DiscoveryItem } from './mod-discovery';
/** Shared authored/standard package storage contract, independent from application source metadata. */
export declare function parseModStorage(value: unknown): AuthoredModDefinition['storage'];
export declare function parseAuthoredMod(value: unknown): AuthoredModDefinition;
export declare function authoredModHash(definition: AuthoredModDefinition): string;
/** Draft metadata only; installed code uses the ordinary plugin directory format. */
export declare class AuthoredModStore {
    readonly dir: string;
    private readonly locks;
    constructor(dir: string, locks: FileLockService);
    list(): Promise<AuthoredMod[]>;
    summaries(): Promise<DiscoveryItem[]>;
    private ids;
    get(id: string): Promise<AuthoredMod>;
    private readMetadata;
    save(id: string, value: unknown, revision?: number): Promise<AuthoredMod>;
    /** Merge inside the existing file transaction so concurrent saves cannot silently overwrite other edits. */
    patch(id: string, value: unknown, revision: number): Promise<AuthoredMod>;
    installedDefinition(id: string): Promise<AuthoredModDefinition>;
    /** Read an immutable approved snapshot; the live loader's hash may precede the latest installation. */
    versionDefinition(id: string, hash: string): Promise<AuthoredModDefinition>;
    /** Discover immutable version identities without loading every version's source. */
    versionIds(id: string): Promise<string[]>;
    private saveVersion;
    markInstalled(id: string, revision: number, hash: string, pluginId: string): Promise<AuthoredMod>;
    uninstallCurrent(id: string, revision: number, uninstall: (mod: AuthoredMod) => Promise<void>): Promise<AuthoredMod>;
    installCurrent(id: string, revision: number, hash: string, pluginId: string, install: (mod: AuthoredMod) => Promise<void>): Promise<AuthoredMod>;
    installVersion(id: string, revision: number, hash: string, pluginId: string, install: (mod: AuthoredMod) => Promise<void>): Promise<AuthoredMod>;
    recordRun(id: string, run: AuthoredModRun, expectedRunId?: string, expectedStatus?: AuthoredModRun['status'], accept?: () => boolean): Promise<AuthoredMod>;
    /** Permanent source removal holds the same writer lock as save/install. Business storage is separate. */
    undefineCurrent(id: string, revision: number, stop: (mod: AuthoredMod) => Promise<void>): Promise<void>;
    materialize(mod: AuthoredMod): Promise<string>;
    private transaction;
}
