import { BehaviorSubject } from 'rxjs';
import { type IPrewarmStateService } from '../prewarm/prewarm-protocol';
import { SettingsManager, ThemeName } from '../settings';
import { Theme, ThemeService } from './theme-types';
export declare class ThemeServiceImpl implements ThemeService {
    currentTheme: BehaviorSubject<Theme>;
    protected readonly settingsManager: SettingsManager;
    protected readonly prewarmState?: IPrewarmStateService;
    init(): void;
    getCurrentTheme(): Theme;
    setTheme(themeKey: ThemeName): void;
    toggleTheme(): void;
}
