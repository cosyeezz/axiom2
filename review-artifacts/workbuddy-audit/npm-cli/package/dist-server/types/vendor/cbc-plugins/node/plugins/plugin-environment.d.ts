import type { HookConfig } from '../../../../node/hooks/hook-protocol.js';
import type { PluginOptionSchema, PluginOptionValues } from './plugin-options-storage';
export interface PluginEnvironmentContext {
    environment?: Readonly<NodeJS.ProcessEnv>;
    pluginId: string;
    pluginRoot: string;
    projectDir: string;
    options: PluginOptionValues;
    userConfig: PluginOptionSchema;
}
export interface SubstitutePluginVariablesOptions {
    /** Content is model-visible, so sensitive user_config values must not be exposed. */
    mode?: 'config' | 'content';
    /** Hook commands use POSIX paths on Windows; MCP/LSP configs keep native paths. */
    transformPath?: (value: string) => string;
    /** Expand regular process environment placeholders after plugin variables. */
    expandEnvironment?: boolean;
}
export declare class MissingPluginUserConfigError extends Error {
    readonly pluginId: string;
    readonly key: string;
    constructor(pluginId: string, key: string);
}
/** Claude Code replaces every character outside this exact allow-list with '-'. */
export declare function sanitizePluginDataId(pluginId: string): string;
export declare function getPluginDataDirectory(pluginId: string, pluginsDirectory?: string): string;
export declare function ensurePluginDataDirectory(pluginId: string, pluginsDirectory?: string): Promise<string>;
export declare function removePluginDataDirectory(pluginId: string, pluginsDirectory?: string): Promise<void>;
export declare function ensurePluginDataDirectoryForText(text: string, context: PluginEnvironmentContext): Promise<void>;
export declare function resolvePluginOptionValues(userConfig: PluginOptionSchema | undefined, storedOptions: PluginOptionValues | undefined): PluginOptionValues;
export declare function createPluginEnvironmentContext(pluginId: string, pluginRoot: string, options?: PluginOptionValues, userConfig?: PluginOptionSchema, projectDir?: string, environment?: Readonly<NodeJS.ProcessEnv>): PluginEnvironmentContext;
export declare function toPluginOptionEnvKey(key: string): string;
export declare function buildPluginOptionEnvironment(options: PluginOptionValues): Record<string, string>;
export declare function buildPluginSubprocessEnvironment(context: PluginEnvironmentContext, transformPath?: (value: string) => string): Promise<Record<string, string>>;
export declare function substitutePluginVariables(text: string, context: PluginEnvironmentContext, options?: SubstitutePluginVariablesOptions): string;
export declare function enrichPluginHookConfigs(hooks: Partial<Record<string, HookConfig[]>>, context: PluginEnvironmentContext, transformPath?: (value: string) => string): Promise<Record<string, HookConfig[]>>;
//# sourceMappingURL=plugin-environment.d.ts.map