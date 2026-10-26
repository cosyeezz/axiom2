import type { AuthoredMod } from './authored-mod-protocol';
import type { AuthoredModHost } from './authored-mod-service';
import type { AuthoredModStore } from './authored-mod-store';
/** Version selection delegates installation and execution to CBC; it owns only the activation receipt. */
export declare function activateModPackage(store: AuthoredModStore, host: AuthoredModHost, sessionId: string, id: string, request: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
/** Only a matching invoking page/version/generation can complete a host-started activation. */
export declare function settleModClientRun(store: AuthoredModStore, sessionId: string, connectionId: string, report: Record<string, unknown>, current?: () => boolean, pageLease?: string): Promise<AuthoredMod | undefined>;
