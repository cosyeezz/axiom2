import { Mods } from '../../vendor/cbc-plugins/node/index.js';
/**
 * The terminal's mod-owned places: the `AbovePrompt` band and the `Pane`s a
 * mod opens with `$.ui.open({ id })` (official semantics: one band instance;
 * one pane per id, docked in fullscreen, else inline above the prompt — the
 * cbc TUI is not fullscreen, so panes are inline).
 *
 * The state lives here, next to the host bindings that change it; cbc-tui only
 * subscribes, asks for a frame, and reports presses/closes back.
 */
type Runtime = NonNullable<Mods.BootstrapResult['runtime']>;
export interface ModPane {
    readonly id: string;
    readonly plugin: string;
    readonly title: string;
    readonly rows?: number;
    readonly columns?: number;
    readonly isFocused: boolean;
    readonly closeOnEscape: boolean;
}
export interface ModToast {
    readonly id: number;
    readonly plugin: string;
    readonly text: string;
}
export interface ModSlotFrame {
    readonly plugin: string;
    readonly scope: string;
    readonly tree: Mods.SerializedElement;
}
export interface ModSlotRenderInput {
    readonly component: 'AbovePrompt' | 'Pane';
    /** `terminal` (Ink TUI) unless a remote surface asks (`cbc-webui`). */
    readonly surface?: string;
    readonly requestId?: string;
    readonly bodyColumns: number;
    readonly maxRows: number;
    readonly isWorking?: boolean;
    /** A pane beside the transcript (`dock`) or above the prompt (`inline`, the default). */
    readonly placement?: 'dock' | 'inline';
}
/** Wired once by mods-bootstrap: the live runtime and the registry `ui.press` reads. */
export declare function bindModSlots(runtime: () => Runtime | undefined, registry: Mods.RenderRegistry): void;
/**
 * Called for every slot change and every `$.ui.invalidate('ui.render')`.
 *
 * @param options.displaysToasts the subscriber draws toasts on screen (the TUI does);
 *   while none is mounted, `--print` / headless runs still see toasts on stderr
 */
export declare function subscribeModSlots(listener: () => void, options?: {
    displaysToasts?: boolean;
}): () => void;
export declare function invalidateModSlots(): void;
export declare function currentModPanes(): readonly ModPane[];
export declare function currentModToasts(): readonly ModToast[];
/** The pane that holds the keyboard, if any: the last focused one shown. */
export declare function focusedModPane(): ModPane | undefined;
/** `$.ui.open(pane)`; an open of an existing id retitles/refocuses it. */
export declare function openModPane(input: Record<string, unknown>, plugin: string): {
    isPlaced: boolean;
};
/** `$.ui.close({ id })`: core's half of `ui.close`, after the hooks agreed. */
export declare function closeModPane(input: Record<string, unknown>): Record<string, never>;
export declare function listModPanes(): readonly Record<string, unknown>[];
/**
 * `$.ui.toast(text)`: a transient line above the prompt while the TUI is mounted
 * (never written over its frame), else a stderr line as before. Remote surfaces
 * get it in the slot snapshot either way.
 */
export declare function showModToast(text: string, plugin: string, timeoutMs?: number): void;
/** `$.ui.status(text)`; an empty text (`$.ui.status(undefined)`) removes the plugin's entry. */
export declare function setModStatus(plugin: string, text: string): void;
export declare function currentModStatuses(): readonly {
    readonly plugin: string;
    readonly text: string;
}[];
/**
 * One frame of a slot: `ui.render` through every mod's hooks, then core.
 * Undefined when no hook drew (core's SENTINEL for the band, `{}` for a pane).
 */
export declare function renderModSlot(input: ModSlotRenderInput): Promise<ModSlotFrame | undefined>;
/** A Button in a slot frame was pressed (hotkey, Enter on the focused one, or a web click). */
export declare function pressModSlot(frame: Pick<ModSlotFrame, 'plugin' | 'scope'>, element: string): Promise<{
    deny?: string;
}>;
/** What a remote surface draws above its composer: the band, the shown pane, the toasts. */
export interface ModSlotsSnapshot {
    readonly band: ModSlotFrame | null;
    readonly pane: (ModSlotFrame & {
        readonly id: string;
        readonly title: string;
        readonly closeOnEscape: boolean;
        readonly placement: 'dock' | 'inline';
        /** The body's width in cells the pane was drawn for. */
        readonly columns: number;
    }) | null;
    readonly toasts: readonly {
        readonly id: number;
        readonly text: string;
    }[];
    readonly statuses?: readonly {
        readonly plugin: string;
        readonly text: string;
    }[];
}
/**
 * One frame of every mod-owned slot for a remote surface. A remote surface has
 * the room a fullscreen terminal has: its pane docks beside the transcript
 * (official `placement: 'dock'`), `columns` of `$.ui.open` sizing it.
 */
export declare function snapshotModSlots(surface: string, bodyColumns?: number, maxRows?: number): Promise<ModSlotsSnapshot>;
/** Hotkey → element key in a slot frame's tree (first Button wins, as the registry indexes). */
export declare function modSlotHotkey(frame: ModSlotFrame | undefined, hotkey: string): string | undefined;
/** The person closed a pane (Esc on a `closeOnEscape` pane): `ui.close` with origin person, which a hook may refuse. */
export declare function closeModPaneByPerson(id: string): Promise<void>;
/** Tests only. */
export declare function resetModSlotsForTests(): void;
export {};
