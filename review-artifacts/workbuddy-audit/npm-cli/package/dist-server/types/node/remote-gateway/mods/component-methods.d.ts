import type { ComponentService } from './component-service';
/** Transport-neutral operations; authenticated session comes from the Chat tool or ACP, not generated code. */
export declare function handleComponentMethod(name: string, params: unknown, sessionId: string, service: ComponentService, signal?: AbortSignal): Promise<Record<string, unknown>>;
