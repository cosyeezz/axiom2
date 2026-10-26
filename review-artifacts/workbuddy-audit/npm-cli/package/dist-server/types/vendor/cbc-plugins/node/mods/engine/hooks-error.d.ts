/**
 * What a rejected `$` call throws in a mod. Official shape (observed on Claude Code 2.1.293):
 * `name === 'HooksError'`, message `<plugin>: <what failed>`.
 */
export declare class HooksError extends Error {
    readonly name = "HooksError";
}
/** `<plugin>: <text>`, without doubling a prefix the text already carries. */
export declare function hooksError(plugin: string, text: string): HooksError;
/**
 * Normalizes whatever a `$` call threw for the mod: always a `HooksError` prefixed with the
 * calling plugin (official messages read `<plugin>: <what failed>`), keeping the original as
 * `cause` so a host error's stack is not lost.
 */
export declare function asHooksError(plugin: string, error: unknown): HooksError;
//# sourceMappingURL=hooks-error.d.ts.map