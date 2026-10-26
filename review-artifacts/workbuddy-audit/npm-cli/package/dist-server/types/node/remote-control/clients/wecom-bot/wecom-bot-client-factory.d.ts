/**
 * WeChat Work AI Bot Client Factory
 *
 * Creates and manages multiple WecomBotClient instances.
 * All instances are loaded from ~/.codebuddy/channels/wecom/instances.json on startup.
 * No DI singleton — all instances are managed here.
 */
import { type WecomBotCredentials } from './wecom-bot-auth';
import { WecomBotClient } from './wecom-bot-client';
export declare const WecomBotClientFactory: unique symbol;
export interface IWecomBotClientFactory {
    /** Get all instances */
    getAll(): WecomBotClient[];
    /** Get instance by instanceId */
    get(instanceId: string): WecomBotClient | undefined;
    /** Create a new instance and register it. Credentials optional — connect() will prompt if missing. */
    create(instanceId: string, credentials?: WecomBotCredentials, displayName?: string): WecomBotClient;
    /** Reuse one QR pending instance; drop extra unbound pendings. */
    ensureQrPending(): WecomBotClient;
    /** After QR bind, expose the live client under the botId-derived id. */
    adoptPending(pendingId: string): string | undefined;
    /** Remove an instance */
    remove(instanceId: string): void;
}
export declare class WecomBotClientFactoryImpl implements IWecomBotClientFactory {
    private readonly logger;
    private readonly clientRegistry;
    private readonly instances;
    protected initialize(): void;
    /**
     * Resolve a dedicated logger per client. Logger is a transient component, so each
     * client gets its own context — sharing one instance let every WecomBotClient
     * overwrite the others' context and all lines carried the last initialised
     * instance's name (e.g. every bot logging as "WecomBotClient:<other bot>").
     */
    private createClientLogger;
    /**
     * Load all instances from instances.json (includes legacy migration),
     * then create instances from environment variables if not already present.
     */
    private loadAllSavedInstances;
    /**
     * If CODEBUDDY_WECOM_BOT_ID + CODEBUDDY_WECOM_BOT_SECRET env vars are set
     * and no 'default' instance exists yet, create one from the env vars.
     */
    private loadInstanceFromEnv;
    getAll(): WecomBotClient[];
    get(instanceId: string): WecomBotClient | undefined;
    ensureQrPending(): WecomBotClient;
    adoptPending(pendingId: string): string | undefined;
    private removeUnboundQrPendings;
    create(instanceId: string, credentials?: WecomBotCredentials, displayName?: string): WecomBotClient;
    remove(instanceId: string): void;
}
