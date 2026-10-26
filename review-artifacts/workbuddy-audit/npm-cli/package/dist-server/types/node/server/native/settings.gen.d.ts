import { Context, Effect, Layer } from 'effect';
import { CliSettingSourcesProvider } from '../../settings/cli-setting-sources-provider';
import { CliSettingsProvider } from '../../settings/cli-settings-provider';
import { type SettingsManagerImpl } from '../../settings/settings-manager';
declare const CliSettingSourcesProviderKey_base: Context.ServiceClass<CliSettingSourcesProviderKey, "server/native/CliSettingSourcesProvider", CliSettingSourcesProvider>;
export declare class CliSettingSourcesProviderKey extends CliSettingSourcesProviderKey_base {
}
export declare const CliSettingSourcesProviderLayer: Layer.Layer<CliSettingSourcesProviderKey, never, never>;
declare const CliSettingsProviderKey_base: Context.ServiceClass<CliSettingsProviderKey, "server/native/CliSettingsProvider", CliSettingsProvider>;
export declare class CliSettingsProviderKey extends CliSettingsProviderKey_base {
}
export declare const CliSettingsProviderLayer: Layer.Layer<CliSettingsProviderKey, never, never>;
declare const SettingsManagerImplKey_base: Context.ServiceClass<SettingsManagerImplKey, "server/native/SettingsManagerImpl", SettingsManagerImpl>;
export declare class SettingsManagerImplKey extends SettingsManagerImplKey_base {
}
export declare const SettingsManagerImplLayer: Layer.Layer<SettingsManagerImplKey, never, never>;
export declare const layer: Layer.Layer<CliSettingSourcesProviderKey | CliSettingsProviderKey | SettingsManagerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof CliSettingSourcesProviderKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof CliSettingsProviderKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SettingsManagerImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, CliSettingSourcesProviderKey | CliSettingsProviderKey | SettingsManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
