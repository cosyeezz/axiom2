import type { AuthoredModService } from './authored-mod-service';
export declare function handleAuthoredModMethod(name: string, params: unknown, sessionId: string, service: AuthoredModService, signal?: AbortSignal, sourceApproved?: boolean): Promise<Record<string, unknown>>;
