/**
 * New custom agents created by AI must be a single lowercase hyphenated id.
 * Existing on-disk agents are NOT required to match this — WorkBuddy and
 * older CLI users may already have mixed-case or underscored names.
 */
export declare const NEW_CUSTOM_AGENT_NAME_PATTERN: RegExp;
export type CustomAgentNameFailure = 'invalid' | 'reserved';
export interface CustomAgentNameOk {
    readonly ok: true;
    readonly name: string;
}
export interface CustomAgentNameErr {
    readonly ok: false;
    readonly reason: CustomAgentNameFailure;
}
export type CustomAgentNameInspection = CustomAgentNameOk | CustomAgentNameErr;
/**
 * Names that must not be minted by create-by-AI (SmartMerge would overlay
 * the shipped agent). Load path does not use this set — existing files stay
 * visible so WorkBuddy / legacy custom agents keep working.
 */
export declare function reservedCustomAgentNames(): ReadonlySet<string>;
/**
 * Path-safety only: one segment, no traversal, no absolute, no NUL.
 * Allows mixed case / underscores so existing WorkBuddy agents still load.
 */
export declare function isSafeCustomAgentPathSegment(name: unknown): name is string;
export declare function inspectNewCustomAgentName(name: unknown): CustomAgentNameInspection;
export declare function describeCustomAgentNameFailure(reason: CustomAgentNameFailure): string;
/**
 * Resolve `<directory>/<name>.md` and refuse anything that escapes `directory`.
 * `name` must be a safe path segment (not the stricter create-by-AI pattern),
 * so delete/open of existing mixed-case agents still works.
 */
export declare function resolveCustomAgentFilePath(directory: string, name: string): string;
/**
 * Containment check for management operations (write / delete / open).
 *
 * `PathUtils.isPathInside` is a string-prefix test, so a symlink placed inside
 * the agents directory passes it while the OS resolves to a target elsewhere —
 * `unlink` would then follow the link and an editor would open the target. So
 * resolve both sides with `realpath` before comparing.
 *
 * Lexical mismatch is not enough to refuse: macOS `/var` and `/private/var`
 * are the same directory after realpath. Only the resolved paths decide.
 *
 * Non-existent paths are expected (create writes a new file): fall back to the
 * deepest existing ancestor. Do not use that fallback for a dangling symlink —
 * the hop chain already decided whether its target escapes.
 *
 * Async on purpose — this runs on the daemon's HTTP path (`/api/v1/agents/*`),
 * where a sync realpath on a slow/network filesystem would block the loop.
 */
export declare function assertCustomAgentFileContained(filePath: string, baseDirectory: string): Promise<void>;
