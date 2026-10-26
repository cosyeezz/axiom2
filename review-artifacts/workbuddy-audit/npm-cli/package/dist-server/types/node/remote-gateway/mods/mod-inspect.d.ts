import { type ModClientInspectProvider } from '../../../vendor/cbc-shared/common/index.js';
export declare function modInspectProviders(clientAvailable: boolean, dynamic?: ModClientInspectProvider[]): Record<string, unknown>;
export declare function validateModInspectOutput(platform: 'host' | 'client', provider: string, method: string, data: unknown): Promise<void>;
export declare function parseModInspectRequest(request: unknown, dynamic?: ModClientInspectProvider[]): Promise<{
    platform: 'host' | 'client';
    provider: string;
    method: string;
    input: Record<string, unknown>;
}>;
export declare function inspectHostSurface(provider: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
