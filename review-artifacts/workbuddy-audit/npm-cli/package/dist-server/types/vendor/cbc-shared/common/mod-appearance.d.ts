export declare const SKIN_COLOR_TOKENS: readonly ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-input', 'bg-card', 'bg-user', 'bg-hover', 'bg-code', 'bg-hover-strong', 'bg-chip', 'border-default', 'border-muted', 'border-input', 'border-field', 'border-field-focus', 'border-card', 'text-primary', 'text-body', 'text-secondary', 'text-label', 'text-tertiary', 'text-user', 'text-link', 'accent-brand', 'accent-brand-foreground', 'accent-blue', 'accent-green', 'accent-red', 'accent-yellow', 'accent-orange', 'accent-purple', 'chat-body', 'chat-muted', 'chat-subtle', 'chat-thinking-line', 'chat-thinking-bg', 'chat-tool-hover', 'focus-ring', 'disabled-text', 'disabled-bg', 'error-bg', 'warning-bg', 'success-bg', 'info-bg', 'composer-border', 'composer-menu-active', 'composer-menu-current', 'composer-menu-active-border', 'composer-send', 'composer-send-hover', 'bg-channel', 'border-channel', 'channel-accent', 'bg-diff-add', 'bg-diff-del', 'scrollbar', 'scrollbar-hover', 'markdown-code', 'composer-glow', 'bot-avatar-outline', 'bot-avatar-shadow', 'canvas-grid-minor', 'canvas-grid-major', 'canvas-tile-border', 'canvas-tile-border-selected', 'canvas-tile-header', 'canvas-tile-header-text', 'canvas-selection-fill', 'canvas-selection-stroke', 'login-bg', 'login-btn-bg', 'login-btn-text', 'login-text-primary', 'login-text-secondary', 'login-ellipse-border', 'login-ellipse-border2'];
export type SkinColorToken = typeof SKIN_COLOR_TOKENS[number];
export type SkinColors = Partial<Record<SkinColorToken, string>>;
/** Dual-mode CSS custom property overrides: `--name` to one bounded CSS value, per palette mode. */
export type SkinTokenValues = Record<string, string>;
export interface SkinTokens {
    light: SkinTokenValues;
    dark: SkinTokenValues;
}
export declare const SKIN_TOKEN_LIMITS: {
    readonly names: 128;
    readonly nameLength: 80;
    readonly valueLength: 512;
    readonly depth: 6;
};
/** Native root variables the client stylesheets already read; skins may override them through `tokens`. */
export declare const NATIVE_SKIN_VARIABLES: readonly {
    name: string;
    valueType: string;
    description: string;
}[];
export interface SkinBackground {
    image: string;
    size: 'cover' | 'contain' | 'tile';
    position: 'center' | 'top' | 'bottom' | 'left' | 'right';
    opacity: number;
    overlay: string;
    overlayOpacity: number;
    panelOpacity: number;
    chatOpacity?: number;
    sidebarOpacity?: number;
    composerOpacity?: number;
    messageOpacity?: number;
    menuOpacity?: number;
    settingsOpacity?: number;
    surfaceBlur?: number;
}
export interface SkinWelcome {
    mode: 'default' | 'hidden' | 'image';
    image?: string;
}
export interface UiSkin {
    name: string;
    description: string;
    light: SkinColors;
    dark: SkinColors;
    tokens?: SkinTokens;
    font?: 'system' | 'mono';
    radius?: number;
    background?: SkinBackground;
    welcome?: SkinWelcome;
}
export interface ModAppearance {
    light?: SkinColors;
    dark?: SkinColors;
    font?: 'system' | 'mono';
    radius?: number;
    background?: SkinBackground;
}
export type { ModMount } from './mod-mount';
export declare function isAppearanceColor(v: unknown): v is string;
/** `--kebab-name`. `--skin-*`/`--mod-*`/`--tw-*` are painter-owned except the explicit exceptions; `--color-*` stays the closed semantic palette (use light/dark for it). */
export declare function isSkinTokenName(v: unknown): v is string;
/** One declaration-free CSS value: no `;{}@!\`, comments, escapes, URLs or functions outside the allowlist. Pure syntax screen with no DOM; a value that passes can still be an invalid property value, in which case the browser ignores that custom property use. */
export declare function isSkinTokenValue(v: unknown): v is string;
/** Both modes are optional records, but are always returned so an override layer can merge per mode. */
export declare function parseSkinTokens(v: unknown): SkinTokens;
/** Validated custom properties for one palette mode; re-filtered so an unparsed skin cannot reach the painter. */
export declare function skinTokenVariables(skin: {
    tokens?: SkinTokens;
} | null | undefined, theme: 'light' | 'dark'): Record<string, string>;
/** Dual-mode override layers (like DSH theme overrides) must name the same tokens in both modes so neither scheme goes illegible. */
export declare function parseSkinTokenOverrides(v: unknown): SkinTokens;
export declare function safeBackgroundImage(v: unknown): string | undefined;
export declare function parseModAppearance(value: unknown, image?: (value: unknown) => string | undefined): ModAppearance;
export declare function parseUiSkin(value: unknown, image?: (value: unknown) => string | undefined): UiSkin;
export declare function appearanceVariables(appearance: ModAppearance | null | undefined, theme: 'light' | 'dark'): Record<string, string>;
/** Describe the same allowlist used by the renderer, not a second style implementation. */
export declare function modStyleSchema(): Record<string, unknown>;
export declare function parseModStyle(value: unknown): Record<string, string | number>;
//# sourceMappingURL=mod-appearance.d.ts.map