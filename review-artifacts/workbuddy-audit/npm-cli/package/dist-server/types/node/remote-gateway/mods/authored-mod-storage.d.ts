import type { AuthoredModDefinition } from './authored-mod-protocol';
/** Compile once from the approved definition; validate inside PluginStore's transaction. */
export declare function authoredStorageValidator(storage: AuthoredModDefinition['storage']): Promise<(state: Record<string, unknown>, scope: 'session' | 'global') => void>;
