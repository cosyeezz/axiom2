export type ModHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface ModHttpRequest {
    method: ModHttpMethod;
    path: string;
    query: Record<string, string>;
    body: unknown;
    sessionId: string;
}
export interface ModHttpRouteInput {
    plugin: string;
    routeId: string;
    method: string;
    path: string;
    noun: string;
    capability: string;
    generation: number;
    runtimeId: string;
    ownerSessionId: string;
    requestSchema?: Record<string, unknown>;
    corsOrigins?: readonly string[];
}
export interface ModHttpRoute extends Omit<ModHttpRouteInput, 'method'> {
    method: ModHttpMethod;
    registeredAt: number;
}
/** Public catalog metadata never exposes the owning session or runtime id. */
export type ModHttpRouteInfo = Omit<ModHttpRoute, 'requestSchema' | 'ownerSessionId' | 'runtimeId'> & {
    requestSchema?: Record<string, unknown>;
};
export interface ModHttpRouteInvokeResult {
    route: ModHttpRoute;
    value: unknown;
}
/**
 * Gateway-owned route registry. It holds only route metadata and a host callback;
 * plugin business state remains in the existing Mods runtime/custom noun.
 */
export declare class ModHttpRouteRegistry {
    private readonly routes;
    register(input: ModHttpRouteInput, invoke: (request: ModHttpRequest) => Promise<unknown>): {
        routeId: string;
        url: string;
        generation: number;
    };
    list(ownerSessionId: string): Array<ModHttpRouteInfo>;
    revoke(plugin: string, routeId?: string): number;
    clearRuntime(runtimeId: string): number;
    find(method: string, plugin: string, routeId: string, path: string): (ModHttpRoute & {
        invoke: (request: ModHttpRequest) => Promise<unknown>;
    }) | undefined;
    allowedMethods(plugin: string, routeId: string, path: string): ModHttpMethod[];
    invoke(route: ModHttpRoute & {
        invoke: (request: ModHttpRequest) => Promise<unknown>;
    }, request: ModHttpRequest): Promise<ModHttpRouteInvokeResult>;
}
export declare const MOD_HTTP_ROUTE_MAX_REQUEST_BYTES: number;
export declare const newModHttpRequestId: () => string;
export declare const modHttpRoutes: ModHttpRouteRegistry;
