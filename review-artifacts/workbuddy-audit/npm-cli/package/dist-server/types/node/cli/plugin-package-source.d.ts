import { type PluginSource } from '../../vendor/cbc-plugins/node/index.js';
export interface PackageSourceOptions {
    ref?: string;
    sha?: string;
    subdir?: string;
    registry?: string;
}
export type DirectPackageSource = {
    kind: 'npm';
    spec: string;
} | {
    kind: 'local' | 'archive';
    root: string;
    identity: string;
} | {
    kind: 'git';
    identity: string;
    source: PluginSource;
};
/** Explicit source parsing never asks npm to execute a Git/local lifecycle. */
export declare function parseDirectPackageSource(input: string, options: PackageSourceOptions, cwd?: string): DirectPackageSource;
