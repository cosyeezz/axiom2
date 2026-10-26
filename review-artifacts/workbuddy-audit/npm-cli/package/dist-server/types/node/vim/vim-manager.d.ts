import { Subject } from 'rxjs';
import { SettingsManager } from '../settings/settings-protocol';
import { VimManager } from './vim-protocol';
export declare class DefaultVimManager implements VimManager {
    protected readonly settingsManager: SettingsManager;
    private static readonly VIM_SETTING_KEY;
    readonly onDidChangeState: Subject<boolean>;
    isEnabled(): Promise<boolean>;
    enable(): Promise<void>;
    disable(): Promise<void>;
    toggle(): Promise<boolean>;
}
