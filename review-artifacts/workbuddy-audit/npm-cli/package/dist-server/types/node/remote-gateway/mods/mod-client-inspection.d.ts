import { type ModClientInspectProvider, type ModClientQuery } from '../../../vendor/cbc-shared/common/index.js';
import { compileToolInputValidator } from '../../tools/tool-input-validation';
type Validator = Awaited<ReturnType<typeof compileToolInputValidator>>;
interface Entry {
    provider: ModClientInspectProvider;
    incarnation: string;
    contract: string;
    methods: Map<string, {
        input: Validator;
        output: Validator;
    }>;
}
interface Page {
    sessionId: string;
    lease: string;
    send(request: ModClientQuery): Promise<unknown>;
    cancel?(requestId: string): Promise<unknown>;
    providers: Map<string, Entry>;
    syncs: number;
}
/** Only a registered authenticated page can answer its own outstanding read-only query. */
export declare class ModClientInspection {
    private readonly pages;
    private readonly pending;
    private readonly attaching;
    private readonly reports;
    private readonly disconnectListeners;
    onDisconnect(listener: (connectionId: string) => void): () => void;
    ready(connectionId: string, sessionId: string, send: Page['send'], lease: string, cancel?: Page['cancel']): void;
    /**
     * Publishes the page's complete dynamic provider directory. Every method must carry compiling input and output
     * schemas and every provider a registration-unique `incarnation`. A rejected directory retracts the previous one,
     * so a page can never keep answering with contracts it no longer vouches for. Resolves false for a stale page,
     * lease or an older concurrent publication.
     */
    sync(connectionId: string, sessionId: string, request: unknown): Promise<boolean>;
    private compileDirectory;
    private apply;
    providers(sessionId: string, connectionId?: string): ModClientInspectProvider[];
    directory(sessionId: string, connectionId?: string): Record<string, unknown>;
    disconnect(connectionId: string, lease?: string): void;
    available(sessionId: string): boolean;
    query(sessionId: string, request: {
        provider: string;
        method: string;
        input?: Record<string, unknown>;
    }, signal?: AbortSignal, connectionId?: string, requestReady?: () => Promise<unknown>): Promise<unknown>;
    ensureReady(sessionId: string, signal?: AbortSignal, connectionId?: string, requestReady?: () => Promise<unknown>): Promise<void>;
    private waitForAttachment;
    reply(connectionId: string, sessionId: string, request: unknown): boolean;
    ownsPage(connectionId: string, sessionId: string, lease: unknown): boolean;
    lease(connectionId: string, sessionId: string): string | undefined;
    report(connectionId: string, sessionId: string, request: unknown, lease: unknown): boolean;
    validateReport(request: unknown): Record<string, unknown>;
    diagnostics(sessionId: string, id: string): Record<string, unknown>[];
    close(): void;
}
export {};
