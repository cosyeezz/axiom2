/**
 * Route a user-typed `/xxx` slash command to the `--plugin-dir` mods runtime.
 *
 * Any mod that registered `on('command.run', { command: 'xxx' }, …)` never
 * enters `CommandManager`; its hook lives on the mods runtime. Callers
 * (acp-view for TUI/Web UI, SlashCommandTool for model-invoked) delegate
 * here so the routing is defined in exactly one place.
 *
 * ## Contract
 *
 * - **Not-a-mod-command** (`/xxx` isn't recognised, or the mod's hook
 *   answers with `{}`) → return `undefined`. Caller must fall through to
 *   normal handling (CommandManager custom command → model prompt).
 * - **Mod answered with text or deny** → return the string. Caller writes
 *   it to the transcript as an assistant message and short-circuits the
 *   turn (`end_turn`).
 *
 * ## Why `{}` falls through instead of pseudo-responding
 *
 * An empty `{}` means the mod's hook ran but has nothing to *say* —
 * typically it opened a pane via `$.ui.open()` and the pane paints
 * through the render channel. Injecting a synthetic "Mod handled ..."
 * message would drown the pane's real output and confuse the model
 * (which may see it as a user instruction). Falling through leaves the
 * side effect intact and hands the raw `/diff` to the next handler.
 *
 * ## Why runtime is passed in (not looked up here)
 *
 * `mods-bootstrap.currentModsRuntime()` is a require-time lookup that
 * pulls the CLI startup path into the test module graph. Making the
 * runtime an argument keeps this helper pure — the caller injects the
 * runtime it already holds, and specs can substitute a mock.
 */
export interface ModCommandDispatchInput {
    /** The raw user text (with leading `/`). */
    readonly text: string;
    /** The mods runtime's dispatch entry (`ModsRuntime.dispatch`). */
    readonly dispatch: (event: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
    /** Host registry tombstone check. Receives the name without a leading slash. */
    readonly isCommandUnregistered?: (name: string) => boolean;
    /** Presentation hint passed to the mod. See {@link DEFAULT_PRESENTATION}. */
    readonly presentation?: {
        readonly isFullscreen?: boolean;
        readonly columns?: number;
        readonly rows?: number;
    };
    /** Optional logger for dispatch failures (fire-and-forget). */
    readonly onError?: (message: string) => void;
    /** Official `PromptOrigin` of the command; the composer when absent. */
    readonly origin?: {
        readonly kind: string;
        readonly [k: string]: unknown;
    };
}
/**
 * Reasonable presentation defaults for a slash-command dispatched from a
 * non-fullscreen surface (Web UI, model-invoked). Mods that check
 * `e.presentation.isFullscreen` (`diff` uses this) pick their inline or
 * dialog branch rather than the docked pane branch.
 */
export declare const DEFAULT_PRESENTATION: Readonly<{
    isFullscreen: false;
    columns: 120;
    rows: 40;
}>;
/**
 * Dispatch `command.run { command, args, presentation, origin }` on the
 * mods runtime and return the mod's response text.
 *
 * @returns the mod's response text (`{ text }` or `{ deny }` payload), or
 *   `undefined` if no mod handled the command / the mod returned `{}`.
 */
export declare function dispatchModCommand(input: ModCommandDispatchInput): Promise<string | undefined>;
