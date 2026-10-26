import { FileSystem } from '@genie/runtime';
export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun' | 'dnf' | 'homebrew' | 'unknown';
export type InstallMethod = {
    type: 'package-manager';
    packageManager: PackageManager;
} | {
    type: 'native';
} | {
    type: 'unknown';
};
export interface Installation {
    version: string;
    tag: 'latest' | 'beta' | 'next';
    method: InstallMethod;
    path: string;
    invoked: string;
}
export declare abstract class InstallationUtils {
    static getCurrentInstallation(binary: string, mfs?: FileSystem, findCmd?: (cmd: string) => Promise<string | undefined>): Promise<Installation>;
    private static detectPackageManager;
    /**
     * Infer the package manager from an install path when command-line
     * detection fails (issue #61217). A path living under a
     * `node_modules` layout is a package-manager install; we distinguish the
     * manager by well-known global store markers, defaulting to npm (which
     * covers the common `/usr/local/lib/node_modules` and nvm layouts).
     */
    private static detectPackageManagerFromPath;
    /**
     * Derive the npm global prefix that owns the running bin script `p`:
     * `<prefix>/lib/node_modules/...` with `<prefix>/bin/<launcher>` on Unix,
     * `<prefix>\node_modules\...` with `<prefix>\<launcher>.cmd` on Windows.
     * The innermost `node_modules` is the one holding this package, so a prefix that
     * itself contains `node_modules` (e.g. `npm config set prefix ~/.npm/node_modules`)
     * still resolves. The launcher check is what tells a global prefix apart from a
     * project-local `node_modules` or the npx cache, so callers never redirect
     * `npm install -g` into a project directory. Branded packages rename `bin` to
     * `<binaryName>`, so the running script's own name is probed alongside the official
     * launchers; any one of them is enough. Without a filesystem probe
     * (`checkLaunchers=false`) only the directory shape is checked.
     */
    static resolveNpmPrefix(p: string | undefined, platform?: NodeJS.Platform, checkLaunchers?: boolean): string | undefined;
}
