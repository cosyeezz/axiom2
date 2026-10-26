import type { BehaviorSubject } from 'rxjs';
import type { ThemeName } from '../settings/settings-protocol';
export interface Theme {
    name: string;
    colors: {
        brand: string;
        primary: string;
        text: string;
        secondary: string;
        textSecondary: string;
        success: string;
        error: string;
        warning: string;
        info: string;
        background: string;
        rowBackground: string;
        border: string;
        disabled: string;
        diff: {
            added: string;
            removed: string;
            addedDimmed: string;
            removedDimmed: string;
            addedWord: string;
            removedWord: string;
        };
        gradient: {
            logo: string[];
            highlight: string[];
        };
        logo: {
            edge: string;
            highlight: string;
            outline: string;
            eye: string;
            body: string;
        };
        thinking: string;
        debug: string;
        planMode: string;
        bashMode: string;
        bashLocalMode: string;
        delegateMode: string;
        toolName: string;
        toolResult: string;
        toolArg: string;
        codeKeyword: string;
        codeString: string;
        codeComment: string;
        codeNumber: string;
        prompt: string;
        cursor: string;
        selection: string;
        link: string;
        hint: string;
        spinner: string;
        progressBar: string;
        badge: string;
        counter: string;
        notificationInfo: string;
        notificationWarning: string;
        notificationError: string;
        notificationSuccess: string;
        agentName: string;
        agentBorder: string;
        permissionAllow: string;
        permissionDeny: string;
        permissionAsk: string;
        filePath: string;
        lineNumber: string;
    };
}
export interface ThemeService {
    currentTheme: BehaviorSubject<Theme>;
    getCurrentTheme(): Theme;
    setTheme(themeName: ThemeName): void;
    toggleTheme(): void;
}
export declare const ThemeService: unique symbol;
