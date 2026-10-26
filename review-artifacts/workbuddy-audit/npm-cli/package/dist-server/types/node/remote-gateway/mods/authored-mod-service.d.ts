import { type PluginManager, type PluginRuntimeRefreshService } from '../../../vendor/cbc-plugins/node/index.js';
import type { AuthoredMod, AuthoredModDiagnostic, AuthoredModRun } from './authored-mod-protocol';
import { AuthoredModStore } from './authored-mod-store';
import { type DiscoveryPage } from './mod-discovery';
import type { InstalledModuleDescription, InstalledModulePage } from './mod-installed-client-service';
export interface AuthoredModHost {
    session(id: string): Promise<{
        cwd: string;
        signal?: AbortSignal;
    }>;
    plugins: Pick<PluginManager, 'addMarketplace' | 'installPlugins' | 'enablePlugins' | 'disablePlugins' | 'getActivePlugins' | 'uninstallPlugins'>;
    refresh: Pick<PluginRuntimeRefreshService, 'refresh'>;
    snapshot(sessionId: string): Promise<Record<string, unknown>>;
    invoke(sessionId: string, input: {
        command: string;
        args: string;
        generation: number;
        requestId: string;
    }): Promise<Record<string, unknown>>;
    render?(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    action?(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    dropView?(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    callTool?(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    capabilities?(sessionId: string): Promise<Record<string, unknown>>;
    call?(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    client?(sessionId: string, id: string): Promise<Record<string, unknown>>;
    installedClients?(sessionId: string): Promise<Record<string, unknown>>;
    installedModules?(sessionId: string): Promise<Record<string, unknown>>;
    searchInstalledModules?(sessionId: string, request: unknown): Promise<InstalledModulePage>;
    describeInstalledModule?(sessionId: string, id: string): Promise<{
        module: InstalledModuleDescription;
    }>;
    installedClientAction?(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    installedModuleAction?(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    inspectQuery?(sessionId: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    inspectList?(sessionId: string): Promise<Record<string, unknown>>;
    clientDiagnostics?(sessionId: string, id: string): Record<string, unknown>[];
    clientConnection?(sessionId: string): string | undefined;
    clientLease?(sessionId: string): string | undefined;
    clientReferenceCurrent?(reference: {
        id: string;
        hash: string;
        generation: number;
        runtimeId?: string;
    }): boolean;
    watchClientRun?(id: string, run: AuthoredModRun): void;
    releaseClientRun?(id: string, runId?: string): void;
    notifyClientRun?(sessionId: string, pluginId: string, run: AuthoredModRun): void;
    catalogChanged?(): void;
}
/** Generate and manage complete Mods; PluginManager remains the install/enable authority. */
export declare class AuthoredModService {
    readonly store: AuthoredModStore;
    private readonly host;
    private readonly managementTails;
    private readonly discovery;
    private readonly activations;
    constructor(store: AuthoredModStore, host: AuthoredModHost);
    list(sessionId: string): Promise<{
        mods: AuthoredMod[];
    }>;
    search(sessionId: string, request: unknown): Promise<DiscoveryPage>;
    describe(sessionId: string, id: string): Promise<Record<string, unknown>>;
    inspectSelf(sessionId: string, id?: string, request?: unknown): Promise<Record<string, unknown>>;
    client(sessionId: string, id: string): Promise<Record<string, unknown>>;
    installedClients(sessionId: string): Promise<Record<string, unknown>>;
    installedModules(sessionId: string): Promise<Record<string, unknown>>;
    installedModuleAction(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    /** Read-only, bounded discovery of ordinary installed modules (client and host-only); never returns source or approvals' raw grants. */
    searchModules(sessionId: string, request: unknown): Promise<InstalledModulePage>;
    describeModule(sessionId: string, id: string): Promise<{
        module: InstalledModuleDescription;
    }>;
    installedClientAction(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    inspect(sessionId: string, request?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    contract(sessionId: string, request?: unknown): Promise<Record<string, unknown>>;
    examples(sessionId: string, request?: unknown): Promise<Record<string, unknown>>;
    saveExample(sessionId: string, id: string, request: unknown): Promise<AuthoredMod>;
    get(sessionId: string, id: string): Promise<AuthoredMod>;
    save(sessionId: string, id: string, request: unknown): Promise<AuthoredMod>;
    private saveCurrent;
    /**
     * Compose the existing lifecycle under one management lease. The model adapter may
     * bind its existing tool approval to the exact source edit; direct API/ACP calls require
     * an explicit trustedHash. Validation/trust failures only leave a draft to repair.
     */
    apply(sessionId: string, id: string, request: unknown, signal?: AbortSignal, sourceApproved?: boolean): Promise<Record<string, unknown>>;
    /** Host-minted identity for new definitions; existing definitions append immutable source without activation. */
    define(sessionId: string, id: string | undefined, request: unknown): Promise<Record<string, unknown>>;
    validate(sessionId: string, id: string, request: unknown, signal?: AbortSignal): Promise<{
        mod: AuthoredMod;
        events: string[];
        diagnostics: AuthoredModDiagnostic[];
    }>;
    install(sessionId: string, id: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    private installValidated;
    enable(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    private enableCurrent;
    run(sessionId: string, id: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    cancelConnection(connectionId: string): void;
    clientReport(sessionId: string, connectionId: string, report: Record<string, unknown>, current?: () => boolean, pageLease?: string): Promise<boolean>;
    stop(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    uninstall(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    undefine(sessionId: string, id: string, request: unknown): Promise<Record<string, unknown>>;
    runtime(sessionId: string): Promise<Record<string, unknown>>;
    capabilities(sessionId: string): Promise<Record<string, unknown>>;
    call(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    render(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    action(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    dropView(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    callTool(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    reload(sessionId: string): Promise<Record<string, unknown>>;
    invoke(sessionId: string, request: unknown): Promise<Record<string, unknown>>;
    private acceptStop;
    private matchesStop;
    private refreshMod;
    private manage;
}
/** Same logical request returns its original receipt, without replaying business operations. */
export declare const MOD_RECEIPT_LIMITS: Readonly<{
    pending: 16;
    results: 128;
    keys: 4096;
    resultBytes: number;
    retentionMs: number;
}>;
export declare class ModCommandReceipts {
    private readonly now;
    private readonly entries;
    constructor(now?: () => number);
    execute<T extends object & {
        requestId: string;
    }>(sessionId: string, input: T, run: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>>;
    private prune;
    releaseSession(sessionId: string): void;
    clear(): void;
}
