import { type ModMount, type UiSkin } from '../../../vendor/cbc-shared/common/index.js';
import type { FileLockService } from '../../lock/lock-protocol';
export interface ManagedSkin {
    id: string;
    revision: number;
    definition: UiSkin;
    updatedAt: number;
}
export interface CustomizationSnapshot {
    revision: number;
    skins: ManagedSkin[];
    activeId: string | null;
    mounts: ModMount[];
}
export declare const SKIN_INSTRUCTIONS = "Create a complete Web UI skin as JSON {name,description,light,dark,tokens?,font?,radius?}.\nlight and dark map semantic color tokens to hex colors, e.g. {'bg-primary':'#ffffff','text-primary':'#202020','accent-brand':'#16794d','accent-brand-foreground':'#ffffff'}.\nUse only the supplied token names. Make the requested visual identity visible throughout the whole UI, including navigation, forms, composer and chat.\nKeep body text and controls legible, with contrasting foreground/background pairs. Include meaningful light and dark palettes, not identical colors.\nfont is system or mono; radius is a number from 0 to 24. Optional tokens:{light:{'--custom-name':'CSS value'},dark:{...}} controls native typography, spacing, shadow and plugin-defined design variables. Discover actual variables through Theme.listTokens; a custom variable changes nothing until UI CSS consumes it. Preserve readable sizing and controls. Both modes should include the same keys. CSS values allow var/calc/clamp/color functions and quoted font families, not selectors, declarations, URLs, markup, escapes or JavaScript. Reserved painter variables must use their structured fields; documented native font/radius variables are permitted.\nOptional background:{image:an explicit user-provided http(s) image URL,size:'cover'|'contain'|'tile',position:'center'|'top'|'bottom'|'left'|'right',opacity:0..1,overlay:hexColor,overlayOpacity:0..1,panelOpacity:0..1,chatOpacity?:0..1,sidebarOpacity?:0..1,composerOpacity?:0..1,messageOpacity?:0..1,menuOpacity?:0..1,settingsOpacity?:0..1,surfaceBlur?:0..24}.\nThese opacities control distinct surfaces, not the whole document: keep wallpaper vivid, sidebar/composer translucent and messages/menus legible.\nSettings opacity is independent of messages and defaults to 0.68. Surface blur affects compact navigation/composer surfaces, not the wallpaper or entire settings page; prefer 0..2 for clear artwork.\nOptional welcome:{mode:'default'|'hidden'|'image',image?:userProvidedImageUrl}. Hide the default welcome image when it conflicts with an immersive skin.\nFor model-authored skinSave calls, use a user-supplied http(s) URL or omit the image and direct the user to the native file-import control. Never inline a large data:image/...;base64 payload in a chat tool call, and never write the skin registry with a script. Native UI file import may keep a bounded data URL internally, outside the model message.\nCover the whole supported semantic palette, not just accent colors. Missing background/text/control/selection tokens leave default white or black surfaces.\nDo not invent image URLs; preserve existing uploaded images when modifying. Users may upload a background separately.\nSave the definition through Mods skinSave and apply it only when authorised. When modifying, preserve user choices unrelated to the request. Tell the user what changed; printing a skin definition in chat does not apply it.";
export declare class SkinService {
    private readonly locks;
    private readonly session;
    private readonly changed;
    private readonly validateMount?;
    private readonly file;
    constructor(dir: string, locks: FileLockService, session: (id: string) => Promise<{
        signal?: AbortSignal;
    }>, changed?: () => void, validateMount?: ((sessionId: string, mount: ModMount) => Promise<void>) | undefined);
    snapshot(sessionId: string): Promise<CustomizationSnapshot>;
    contract(sessionId: string, request?: unknown): Promise<Record<string, unknown>>;
    save(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    apply(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    remove(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    mount(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    updateMount(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    private parseMount;
    private checkMount;
    unmount(sessionId: string, request: unknown): Promise<CustomizationSnapshot>;
    private requireRevision;
    private read;
    private transaction;
}
export declare function handleSkinMethod(name: string, params: unknown, sessionId: string, service: SkinService): Promise<Record<string, unknown>>;
