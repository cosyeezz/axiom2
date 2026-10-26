import { type SessionManager as SessionManagerInterface } from '../../vendor/cbc-core/node/index.js';
import { type SettingsManager as SettingsManagerInterface } from '../settings/settings-protocol';
import { type SensitiveProtectionPolicy as SensitiveProtectionPolicyInterface } from './sensitive-content-protocol';
export declare class SettingsSensitiveProtectionPolicy implements SensitiveProtectionPolicyInterface {
    protected readonly settingsManager: SettingsManagerInterface;
    protected readonly sessionManager: SessionManagerInterface;
    isEnabled(request?: {
        sessionId?: string;
        signal?: AbortSignal;
    }): Promise<boolean>;
    /** fullAccess is the per-session equivalent of disabling sensitive protection. */
    private isFullAccessSession;
    private isFullAccess;
}
