import { type LoadOptions } from './load-mod';
/** Identities a package can never claim: host builtins and the engine origin, regardless of `withBuiltins`. */
export declare function reservedModNames(): ReadonlySet<string>;
/**
 * Group candidate roots by manifest `name` from metadata only: no hooks module is read or evaluated.
 *
 * - A name reserved by the host (builtin mods, `engine`) refuses the package outright.
 * - The same physical root listed twice is deduplicated: later listings are refused as repeats.
 * - Two distinct roots sharing a name are both refused, so neither can own the identity.
 * - Roots that are not mods, or whose manifest is unreadable or nameless, never block other roots;
 *   the normal load path reports their own error.
 *
 * Returns dir -> concrete refusal reason, one entry per refused root.
 */
export declare function preflightDuplicateNames(dirs: readonly string[], load?: LoadOptions, loadFor?: (root: string) => LoadOptions): Promise<Map<string, string>>;
//# sourceMappingURL=duplicate-preflight.d.ts.map