import { type PluginInfo, type PluginManager } from '../../../vendor/cbc-plugins/node/index.js';
import { type ModClientPackage } from '../../../vendor/cbc-shared/common/index.js';
import { type InstalledModApprovals } from './mod-installed-approvals';
export interface InstalledModClientRow {
    id: string;
    pluginId: string;
    name: string;
    description: string;
    version?: string;
    hash?: string;
    entry?: string;
    enabled: boolean;
    approved: boolean;
    error?: string;
    source?: string;
    installScope?: PluginInfo['installScope'];
    hasClient?: boolean;
    hasHost?: boolean;
    active?: boolean;
    renderable?: boolean;
    apiVersion?: number;
    hostVersion?: string;
    dependencies?: Array<{
        pluginId: string;
        version?: string;
        installed: boolean;
        enabled: boolean;
        compatible: boolean;
    }>;
    packagedComponents?: Array<{
        id: string;
        name: string;
        version: number;
        hash: string;
        aliases: string[];
    }>;
}
interface Dependencies {
    plugins: Pick<PluginManager, 'getInstalledPlugins' | 'getActivePlugins' | 'enablePlugins' | 'disablePlugins' | 'uninstallPlugins'>;
    approvals: InstalledModApprovals;
    resourceSnapshots?: {
        root: string;
        acquireLock(name: string): Promise<() => Promise<void>>;
    };
    refresh(ids: string[]): Promise<void>;
    changed(): void;
    runtimeId: string;
    hostVersion?: string;
    hostState?(name: string, root: string): {
        hash?: string;
        generation?: number;
        error?: string;
        active: boolean;
        events?: readonly string[];
    };
}
export interface InstalledModuleSummary {
    id: string;
    pluginId: string;
    name: string;
    description: string;
    version?: string;
    source?: string;
    installScope?: PluginInfo['installScope'];
    enabled: boolean;
    active: boolean;
    hasClient: boolean;
    hasHost: boolean;
    compatible: boolean;
    error?: string;
}
export interface InstalledModuleDescription extends Omit<InstalledModuleSummary, 'description'> {
    description: string;
    marketplace: string;
    approval: {
        required: boolean;
        approved: boolean;
        sourceHash?: string;
    };
    compatibility: {
        compatible: boolean;
        currentHost: string;
        apiVersion?: number;
        hostVersion?: string;
        reason?: string;
    };
    dependencies: NonNullable<InstalledModClientRow['dependencies']>;
    packagedComponents: NonNullable<InstalledModClientRow['packagedComponents']>;
}
export interface InstalledModulePage {
    items: InstalledModuleSummary[];
    total: number;
    nextCursor: string | null;
}
export declare const installedModClientId: (id: string) => string;
/** PluginManager owns installation and activation; settings owns explicit browser source approval. */
export declare class InstalledModClientService {
    private readonly deps;
    private readonly discovery;
    /** Shared by all pages using this host service; approval/state checks remain outside pure compilation. */
    private readonly resourceWork;
    private resourceRequests;
    private readonly snapshots;
    private readonly metadata;
    private readonly compilations;
    /** Share overlapping reads only, never a completed source snapshot or an authorization decision. */
    private readonly verifying;
    /** Compilation is pure; authorization and filesystem identity are never cached. */
    private readonly compiled;
    /** Per exact installed id: ordinary management actions run one at a time in acceptance order; other ids never wait. */
    private readonly managementTails;
    constructor(deps: Dependencies);
    private snapshot;
    private get hostVersion();
    private installed;
    private checked;
    private selectedVersion;
    private unchanged;
    /** One row builder serves the browser list, the host-visible list and bounded model discovery. */
    private row;
    private readRow;
    private rows;
    list(includeHost?: boolean): Promise<{
        plugins: InstalledModClientRow[];
    }>;
    private summary;
    /**
     * Bounded, source-free discovery of installed Mods, including host-only register-module packages.
     * Reads manifests and PluginManager state only; paging and ranking stay in the shared discovery index.
     */
    search(request?: unknown): Promise<InstalledModulePage>;
    /** Exact metadata for one module. Includes the source hash and approval state, never file contents or paths. */
    describe(id: string): Promise<{
        module: InstalledModuleDescription;
    }>;
    private authorizedSnapshot;
    private activeAuthorization;
    private authorizedGeneration;
    authorize(id: string): Promise<{
        pluginId: string;
        name: string;
        root: string;
        hash: string;
        generation: number;
    }>;
    /** Resolve atoms only from the same complete, approved snapshot as the live host package. */
    componentSource(name: string, root: string): Promise<{
        resolver: import("./component-package").PackageComponentResolver;
        pluginId: string;
        name: string;
        root: string;
        hash: string;
        generation: number;
    }>;
    references(): Promise<Array<Omit<ModClientPackage, 'code'>>>;
    private resource;
    load(id: string): Promise<ModClientPackage>;
    private loadCurrent;
    asset(id: string, request: {
        hash: string;
        generation: number;
        runtimeId: string;
        path: string;
    }, signal?: AbortSignal): Promise<{
        bytes: Buffer;
        mime: string;
    }>;
    private readCurrentAsset;
    private resourceBinding;
    /**
     * Validates and snapshots the request synchronously, then serializes the whole transition for this installed id.
     * Later caller mutation of `request` cannot change an already accepted action.
     */
    action(id: string, request: unknown, allowHost?: boolean): Promise<Record<string, unknown>>;
    private manage;
    /** Runs inside the per-id boundary: the installed source identity is resolved fresh, after earlier actions finished. */
    private perform;
    private collectUnusedResources;
}
export {};
