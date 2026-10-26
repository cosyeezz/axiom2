import { type SettingsManager, SettingsScope } from './settings-protocol';
/** Scene variants that users can map through `/model:lite` and `/model:reasoning`. */
export declare const EDITABLE_VARIANTS: readonly ["lite", "reasoning"];
export type EditableVariant = (typeof EDITABLE_VARIANTS)[number];
/** Sentinel used by model pickers to clear a variant mapping. */
export declare const INHERIT_DEFAULT_VALUE = "__inherit_default__";
export type VariantModelSettings = Partial<Record<EditableVariant, string>>;
/**
 * Reads one variant mapping from a specific settings scope. `inherit` / `default`
 * mean "not configured", matching AgentManager's variant resolution.
 */
export declare function getVariantModelSetting(settingsManager: SettingsManager, variant: EditableVariant, scope: SettingsScope): Promise<string | undefined>;
/**
 * Writes or clears one variant mapping while preserving the other variant.
 * An empty value or the inherit sentinel removes the mapping.
 *
 * The read-modify-write runs inside SettingsManager's scope lock, and an
 * unchanged value is a no-op (no disk write, no settings change event).
 */
export declare function setVariantModelSetting(settingsManager: SettingsManager, variant: EditableVariant, modelValue: string | undefined, scope: SettingsScope): Promise<void>;
/** Removes one user-defined variant mapping and restores the existing variant resolution chain. */
export declare function resetVariantModelSetting(settingsManager: SettingsManager, variant: EditableVariant, scope: SettingsScope): Promise<void>;
