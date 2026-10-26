import { Theme } from './theme-types';
export declare const lightTheme: Theme;
export declare const darkTheme: Theme;
export declare const lightThemeColorblind: Theme;
export declare const darkThemeColorblind: Theme;
export declare const lightThemeAnsi: Theme;
export declare const darkThemeAnsi: Theme;
export declare const noColorTheme: Theme;
export declare const themes: Record<string, Theme>;
/**
 * Get all available theme keys for current terminal
 */
export declare const getAvailableThemeKeys: () => string[];
/**
 * Get theme by key, with fallback to 'dark' theme
 */
export declare const getThemeByKey: (key: string) => Theme;
