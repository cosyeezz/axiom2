import type { AuthoredModStore } from './authored-mod-store';
interface Runtime {
    runtimeId?: string;
    generation?: number;
    mods?: Array<{
        id: string;
        hash?: string;
        generation?: number;
        events?: string[];
    }>;
    failures?: Array<{
        mod?: string;
        reason?: string;
    }>;
    installed?: Array<{
        id: string;
        status: string;
    }>;
}
/** Selected plugin/package inspection is read-only and distinguishes definition, installation and live execution. */
export declare function inspectModSelf(store: AuthoredModStore, id: string, request: unknown, runtime: Runtime, clientReports?: Record<string, unknown>[]): Promise<Record<string, unknown>>;
export {};
