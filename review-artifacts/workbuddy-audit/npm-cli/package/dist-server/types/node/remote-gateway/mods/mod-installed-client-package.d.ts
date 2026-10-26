import { type ModActivationEvent, type ModClientContributions } from '../../../vendor/cbc-shared/common/index.js';
/**
 * Foundation for standard (installed, third-party) browser Client packages.
 *
 * Pure: it validates a manifest declaration and compiles an explicit, immutable file snapshot into a
 * function body for the existing browser Client host. It never scans a filesystem, installs, approves
 * or executes package code; the caller evaluates the returned body with `new Function('React', code)`
 * only after its own approval step.
 */
export interface ModClientDeclaration {
    platform: 'web';
    entry: string;
    format: 'module';
    apiVersion?: 1;
    hostVersion?: string;
    activationEvents?: ModActivationEvent[];
    contributes?: ModClientContributions;
}
export declare const MOD_CLIENT_API_VERSION = 1;
export interface CompiledModClientPackage {
    /** Function body for `new Function('React', code)`; it returns `{ inject, provides?, apply(ctx) }`. */
    code: string;
    /** Package-relative source files that were compiled, entry first. */
    inputs: string[];
}
export type ModClientFiles = ReadonlyMap<string, string> | Readonly<Record<string, string>>;
export declare const MOD_CLIENT_PACKAGE_LIMITS: {
    readonly files: 512;
    readonly sourceBytes: number;
    readonly pathLength: 256;
};
/** Strict parse of `manifest.client`: exactly `{ platform: 'web', entry, format: 'module' }`. */
export declare function parseModClientDeclaration(value: unknown): ModClientDeclaration;
export declare function assertModClientCompatibility(declaration: ModClientDeclaration, hostVersion: string): void;
/** Reads `client` from a parsed plugin manifest; packages without one have no browser Client. */
export declare function parseManifestModClient(manifest: unknown): ModClientDeclaration | undefined;
/**
 * Compile `files[entry]` and its relative imports without executing any of it.
 * Only `react` / `react-dom` (host-provided) and relative .js/.mjs/.cjs/.json modules inside the snapshot may be imported.
 */
export declare function compileModClientPackage(input: {
    entry: string;
    files?: ModClientFiles;
    source?: {
        paths: ReadonlySet<string>;
        readText(path: string, maxBytes: number): Promise<string>;
    };
}): Promise<CompiledModClientPackage>;
