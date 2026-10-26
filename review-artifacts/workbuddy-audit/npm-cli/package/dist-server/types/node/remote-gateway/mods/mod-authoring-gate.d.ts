import type { CodebuddySettings } from '../../settings/settings-protocol';
export declare const MOD_AUTHORING_ENV = "CODEBUDDY_MOD_AUTHORING_ENABLED";
export interface ModAuthoringSession {
    id?: string;
    meta?: Record<string, unknown>;
    agentName?: string;
    options?: {
        webUiAcp?: boolean;
        print?: boolean;
        inputFormat?: string;
    };
}
export interface ModAuthoringSettingsSource {
    get(key: 'codebuddy'): Promise<CodebuddySettings | undefined>;
}
export declare function isBundledModAuthoringSkill(skill: {
    name: string;
    source?: string;
    id?: string;
}): boolean;
/** Host veto precedes settings: a shared HOME or --serve never enables WorkBuddy. */
export declare function isModAuthoringHostAllowed(): boolean;
export declare function isModAuthoringSurface(session: ModAuthoringSession | undefined): boolean;
export declare function isModAuthoringConfigured(settings: ModAuthoringSettingsSource): Promise<boolean>;
export declare function isModAuthoringEnabled(session: ModAuthoringSession | undefined, settings: ModAuthoringSettingsSource): Promise<boolean>;
/** Creator controls model authoring, not the lifetime of already installed UI. */
export declare function isModAuthoringSession(session: ModAuthoringSession | undefined): boolean;
export declare function isModUiEnabled(session: ModAuthoringSession | undefined, settings: ModAuthoringSettingsSource): Promise<boolean>;
export declare function requireModAuthoring(session: ModAuthoringSession | undefined, settings: ModAuthoringSettingsSource): Promise<void>;
