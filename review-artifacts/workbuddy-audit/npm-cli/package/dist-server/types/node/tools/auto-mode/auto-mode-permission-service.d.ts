import { Logger } from '@genie/telemetry';
import { SettingsManager } from '../../settings';
import { AutoModeClassifierClientImpl } from './auto-mode-classifier-client';
import { AutoModeDenialTracker } from './auto-mode-denial-tracker';
import { AutoModeProjectInstructionsResolver } from './auto-mode-project-instructions';
import { AutoModeAvailability, AutoModePermissionRequest, AutoModePermissionResult, AutoModePermissionService } from './auto-mode-protocol';
import { AutoModeSettingsResolver } from './auto-mode-settings';
/**
 * Auto mode permission service — the single entry point host code depends on.
 *
 * Orchestrates: availability gate -> rule resolution -> classifier -> verdict
 * mapping with interactive/non-interactive fallback. Owns no host-flow state;
 * `tool-permission-service` calls `classifyAsk` once when an ask would occur in
 * auto mode.
 *
 * Circuit breaker: consecutive classifier *failures* (not block verdicts) open
 * the breaker; while open we skip the classifier and fall back directly, so a
 * failing model is not hammered. A successful call resets it.
 */
export declare class AutoModePermissionServiceImpl implements AutoModePermissionService {
    protected readonly settingsManager: SettingsManager;
    protected readonly classifier: AutoModeClassifierClientImpl;
    protected readonly rulesResolver: AutoModeSettingsResolver;
    protected readonly denialTracker: AutoModeDenialTracker;
    protected readonly projectInstructionsResolver: AutoModeProjectInstructionsResolver;
    protected readonly logger: Logger;
    isAutoModeAvailable(): Promise<AutoModeAvailability>;
    isSettingsAutoGrantAllowed(): Promise<boolean>;
    classifyAsk(request: AutoModePermissionRequest): Promise<AutoModePermissionResult>;
    /** Short human-readable label for a blocked action (toolName + truncated projection). */
    private buildDisplay;
    /**
     * Reason text for a tripped denial limit. Shared by the two outcomes that
     * count toward it — a real block verdict and a no-verdict failure — so both
     * read the same way; the `reason` tail is what distinguishes them.
     */
    private buildDenialLimitReason;
    /**
     * Breaker-open short-circuit: the classifier has failed repeatedly, so leave
     * auto mode and let the action go through normal default-mode handling (a
     * prompt interactively, deny headless) — Claude `kickOutOfAuto`. Not the
     * per-error fail-closed path.
     */
    private fallback;
    /**
     * Per-error fail-closed result (Claude §10): a classifier error blocks the
     * action for safety regardless of interactivity. `kickOutOfAuto` is set when
     * the failure just opened the breaker, so subsequent actions leave auto.
     */
    private failClosed;
}
