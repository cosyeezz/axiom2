import { Logger } from '@genie/telemetry';
import { AutoModeSettings, SettingsManager } from '../../settings';
import { AutoModeRules } from './auto-mode-protocol';
export declare const AutoModeSettingsResolver: unique symbol;
export interface AutoModeSettingsResolver {
    /** Effective auto mode rules after merging allowed sources and expanding $defaults. */
    resolve(): Promise<AutoModeRules>;
    /**
     * Merged-but-UNEXPANDED custom rules (the `$defaults` token is preserved).
     * Used by critique to (a) detect whether a section replaces or extends the
     * defaults, and (b) filter out `$defaults` so only the user's own custom
     * entries are reviewed — mirrors Claude `HDH()` + `is6()`.
     */
    resolveRaw(): Promise<AutoModeSettings>;
}
/**
 * Resolves effective auto mode rules.
 *
 * Source policy (no enterprise policy/flag sources in this product):
 *  - reads `autoMode` from user / project-local / CLI scopes
 *  - shared project settings are NOT read (prevents checked-in repos injecting allow rules)
 *
 * `$defaults` semantics per section:
 *  - section unset                  -> use built-in defaults
 *  - array containing `$defaults`    -> expand defaults in place
 *  - array without `$defaults`       -> replace built-in defaults (warns for soft/hard_deny)
 */
export declare class AutoModeSettingsResolverImpl implements AutoModeSettingsResolver {
    protected readonly settingsManager: SettingsManager;
    protected readonly logger: Logger;
    resolve(): Promise<AutoModeRules>;
    resolveRaw(): Promise<AutoModeSettings>;
    /** Merge `autoMode` from allowed scopes (later scopes append after earlier ones). */
    private mergeAllowedSources;
    private expandSection;
}
