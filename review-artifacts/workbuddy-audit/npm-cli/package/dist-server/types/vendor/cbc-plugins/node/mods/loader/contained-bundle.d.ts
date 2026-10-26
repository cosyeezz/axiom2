import { type PlatformPath } from 'node:path';
import { type ModBundle } from './mod-compiler';
/** Path operations the contained resolver needs; a mounted filesystem may supply win32 or posix semantics. */
export type ContainedPaths = Pick<PlatformPath, 'resolve' | 'relative' | 'dirname' | 'join' | 'isAbsolute'>;
export interface ContainedSourceFileSystem {
    readText(path: string): Promise<string>;
    paths: ContainedPaths;
}
/** True when a `paths.relative(root, target)` result leaves the root. */
export declare function isOutsideRelative(paths: Pick<PlatformPath, 'isAbsolute'>, relativePath: string): boolean;
/** Host cache bookkeeping at the package root; excluded from the source hash, so never executable. */
export declare const MOD_SOURCE_RUNTIME_ENTRIES: readonly ['.in_use', '.orphaned_at', '.codebuddy-directory-source.json'];
/**
 * True when a root-relative path lies in a subtree the source fingerprint does not hash:
 * `node_modules` or `.git` at any depth, or a runtime bookkeeping entry at the root.
 * Code there would run without being covered by the content identity, so it is not importable.
 */
export declare function isUnhashedRelative(relativePath: string): boolean;
/** Throws if `path` leaves `root` or enters an unhashed subtree (lexical check; use with a mount's `paths`). */
export declare function assertContainedEntry(paths: Pick<PlatformPath, 'isAbsolute'>, _root: string, path: string, relativePath: string): void;
/** Lexical containment for native paths. */
export declare function isInsideRoot(root: string, path: string): boolean;
/** Native reader: follows symlinks, but refuses any file whose realpath leaves the root or enters an unhashed subtree. */
export declare function createContainedReader(root: string): (path: string) => Promise<string>;
/** True when every recorded compiler input still resolves inside the root; guards compiled-graph cache hits. */
export declare function inputsStayInRoot(root: string, inputs: readonly string[]): Promise<boolean>;
/**
 * Compile an entry reading and resolving only through `fs`: relative/absolute specifiers must stay
 * under `root`; node builtins and bare packages are rejected; the only non-file imports are the
 * cbc-jsx shim and the compiler's allowed externals. Nothing here evaluates author code.
 */
export declare function bundleContainedMod(fs: ContainedSourceFileSystem, entry: string, root: string): Promise<ModBundle>;
/** Native filesystem view of a package root, for `bundleContainedMod`. */
export declare function nativeContainedFileSystem(root: string): ContainedSourceFileSystem;
//# sourceMappingURL=contained-bundle.d.ts.map