import { AuthoredModService } from './authored-mod-service';
import { ModClientInspection } from './mod-client-inspection';
import { type ModHttpRequest } from './mod-http-routes';
export declare class AuthoredModRuntime {
    private readonly runtimeId;
    readonly browser: ModClientInspection;
    private readonly sessions;
    private readonly plugins;
    private readonly locks;
    private readonly feedback;
    private readonly settings;
    private readonly refresh;
    private installedClients?;
    private packageInstaller?;
    private exporter?;
    private prewarming?;
    /**
     * Pre-read approved installed package metadata after the HTML request. Code remains demand-loaded;
     * the page's own runtime/client requests still check current authorization independently.
     */
    prewarmInstalledClients(): void;
    readAsset(id: string, request: {
        hash: string;
        generation: number;
        runtimeId: string;
        path: string;
    }, signal?: AbortSignal): Promise<{
        bytes: Buffer;
        mime: string;
    }>;
    /** Dispatches a public route through the owning plugin's approved custom noun. */
    invokeHttpRoute(sessionId: string, plugin: string, routeId: string, request: ModHttpRequest): Promise<unknown>;
    exportMod(sessionId: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    installWebPackage(request: unknown): Promise<Record<string, unknown>>;
    private instance?;
    private clientRuns?;
    private disconnectClients?;
    private readonly receipts;
    private receiptGeneration;
    private readonly renders;
    private readonly actions;
    private renderTail;
    private readonly receiptSessions;
    private invalidateDispose?;
    private invalidateTimer?;
    private syncGeneration;
    private getInstalledClients;
    /** Exact source identity of an installed Mod package, for an installer that approves what it just installed. */
    installedClientSource(pluginId: string): Promise<{
        hash: string;
        approved: boolean;
        enabled: boolean;
    }>;
    /** Explicit terminal approval applies to the currently installed package, not future versions. */
    approveInstalledClient(pluginId: string, expectedHash: string): Promise<void>;
    get service(): AuthoredModService;
    close(): Promise<void>;
}
