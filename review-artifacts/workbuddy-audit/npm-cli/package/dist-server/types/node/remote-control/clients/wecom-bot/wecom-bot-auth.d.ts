/**
 * WeChat Work AI Bot Credential Management
 *
 * Credentials are stored as a JSON array in a single file:
 *   ~/.codebuddy/channels/wecom/instances.json
 *
 * Each entry: { instanceId, displayName, credentials: WecomBotCredentials }
 *
 * Environment variables (CODEBUDDY_WECOM_BOT_ID, CODEBUDDY_WECOM_BOT_SECRET)
 * are still supported: when instances.json is empty and env vars are set,
 * an instance is auto-created from them.
 */
export interface WecomBotCredentials {
    botId: string;
    secret: string;
    wsUrl: string;
}
export interface WecomInstanceEntry {
    instanceId: string;
    displayName: string;
    credentials: WecomBotCredentials;
    /** daemon 启动时是否自动连接（默认 true） */
    autoConnect?: boolean;
    /**
     * Whether this bot streams assistant text into WeCom.
     * Omitted / true → stream; false → 2.140.0-style WeComReply only.
     */
    streaming?: boolean;
    /**
     * Whether Ask / permission / suggestion use template cards.
     * Omitted / true → vote cards; false → 2.140.0-style text (y/n / 编号).
     */
    cards?: boolean;
    /**
     * Whether channel (频道) posts / replies are consumed as agent input.
     * Omitted / false → off (events are only logged). Opt-in: every new post wakes the agent.
     */
    topicEvents?: boolean;
}
/** Streaming is on unless the instance explicitly opts out. */
export declare function isWecomStreamingEnabled(streaming?: boolean): boolean;
/** Cards are on unless the instance explicitly opts out. */
export declare function isWecomCardsEnabled(cards?: boolean): boolean;
/** Channel events are off unless the instance explicitly opts in. */
export declare function isWecomTopicEventsEnabled(topicEvents?: boolean): boolean;
export declare function wecomDeliveryMode(streaming?: boolean): 'stream' | 'reply';
/** 解析 0/1/true/false/on/off 风格的环境变量；未设置或无法识别返回 undefined。 */
export declare function parseWecomFlagEnv(name: string): boolean | undefined;
/**
 * 企微机器人全局默认（供多个机器人共享，避免逐个配置）。
 * 优先级：global.json（UI/TUI 设置） > 环境变量(CODEBUDDY_WECOM_*_DEFAULT) > 内置默认(true)。
 * 未配置的项返回 undefined，调用方落到"实例级 > 内置默认"语义。
 */
export declare function wecomGlobalDefaults(): {
    streaming?: boolean;
    cards?: boolean;
};
/** 保存全局默认到 global.json（原子写）。返回合并后的最新值。 */
export declare function saveWecomGlobalDefaults(patch: {
    streaming?: boolean;
    cards?: boolean;
}): {
    streaming?: boolean;
    cards?: boolean;
};
/** Load all instance entries from instances.json (with legacy migration). */
export declare function loadAllInstances(): WecomInstanceEntry[];
/** Load credentials for a specific instance. */
export declare function loadWecomCredentials(instanceId: string): WecomBotCredentials | undefined;
/** Save (upsert) credentials for an instance. Preserves streaming / cards / autoConnect. */
export declare function saveWecomCredentials(credentials: WecomBotCredentials, instanceId: string, displayName?: string): void;
/**
 * Patch instance options. If the instance has no disk row yet, upsert one when
 * credentials are provided or resolvable from env (env-created `default`).
 */
export declare function updateWecomInstanceOptions(instanceId: string, patch: Partial<Pick<WecomInstanceEntry, 'streaming' | 'cards' | 'topicEvents' | 'autoConnect' | 'displayName'>>, credentials?: WecomBotCredentials): WecomInstanceEntry | undefined;
/** Remove credentials for an instance. */
export declare function clearWecomCredentials(instanceId: string): void;
/** List all saved instance IDs. */
export declare function listWecomCredentialInstances(): string[];
export declare function wecomInstanceIdFromBotId(botId: string): string;
export declare function isWecomQrPendingInstanceId(instanceId: string): boolean;
/**
 * Resolve credentials from environment variables or disk for a given instance.
 * Environment variables take priority over saved credentials.
 *
 * Env var naming: CODEBUDDY_WECOM_BOT_ID_{INSTANCE} / CODEBUDDY_WECOM_BOT_SECRET_{INSTANCE}
 * Legacy no-suffix env vars (CODEBUDDY_WECOM_BOT_ID) are checked for the 'default' instance.
 */
export declare function resolveWecomCredentials(instanceId: string): WecomBotCredentials | undefined;
