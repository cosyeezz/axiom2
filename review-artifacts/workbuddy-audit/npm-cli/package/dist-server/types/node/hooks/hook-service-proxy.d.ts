import { RestOperations } from '@celljs/http';
import { ProductManager } from '@genie/product';
import { UserinfoProvider } from '@genie/runtime';
import { Logger } from '@genie/telemetry';
export declare const HookServiceProxy: unique symbol;
/**
 * Response from the hook service proxy
 */
export interface HookServiceProxyResponse {
    success: boolean;
    decision?: 'allow' | 'deny' | 'warn';
    reason?: string;
    warnings?: string[];
    data?: Record<string, unknown>;
    error?: {
        code: string;
        message: string;
    };
}
/**
 * Interface for the hook service proxy
 */
export interface HookServiceProxy {
    /**
     * Invoke a registered service through the gateway
     * @param serviceId - The registered service ID on the gateway
     * @param method - The HTTP method to use
     * @param path - The path to forward to (will be prefixed with /v2/service-proxy)
     * @param payload - The payload to forward (passed as-is)
     * @returns The response from the gateway/service
     */
    invoke(serviceId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, payload: unknown): Promise<HookServiceProxyResponse>;
}
/**
 * Implementation of HookServiceProxy
 *
 * Forwards requests to the gateway using the common HTTP client,
 * which includes authentication and other shared configurations.
 */
export declare class HookServiceProxyImpl implements HookServiceProxy {
    protected readonly restOperations: RestOperations;
    protected readonly productManager: ProductManager;
    protected readonly userinfoProvider: UserinfoProvider;
    protected readonly logger: Logger;
    private requestScoped;
    invoke(serviceId: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH', path: string, payload: unknown): Promise<HookServiceProxyResponse>;
}
