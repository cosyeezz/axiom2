import { Settings, SettingsManager } from './settings-protocol';
export interface SettingsOptions {
    global: boolean;
}
export interface KeyRequest {
    key: keyof Settings;
}
export interface KeyValueRequest extends SettingsOptions {
    key: keyof Settings;
    value: any;
}
export interface KeyValuesRequest extends SettingsOptions {
    key: keyof Settings;
    values: any[];
}
export declare class SettingsController {
    protected readonly settingsManager: SettingsManager;
    set(request: KeyValueRequest): Promise<void>;
    get(request: KeyRequest): Promise<Settings[keyof Settings]>;
    add(request: KeyValuesRequest): Promise<void>;
    remove(request: KeyValuesRequest): Promise<void>;
    list(): Promise<Settings>;
}
