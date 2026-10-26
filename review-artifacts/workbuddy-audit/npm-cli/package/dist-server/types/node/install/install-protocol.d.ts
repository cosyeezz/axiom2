import type { Event } from '@celljs/core';
import type { FileSystem } from '@genie/runtime';
import type { Installation, PackageManager } from '../utils/installation-utils';
export type { Installation, PackageManager };
export declare const ReleasesService: unique symbol;
export interface ReleasesService {
    getLatestVersion(): Promise<string>;
    getDownloadUrl(version: string, os: {
        platform: () => NodeJS.Platform;
        arch: () => NodeJS.Architecture;
    }): string;
}
/**
 * Progress events emitted during installation
 */
export type InstallProgressEvent = {
    type: 'start';
    version: string;
} | {
    type: 'downloading';
    url: string;
} | {
    type: 'extracting';
    destination: string;
    skipped?: boolean;
} | {
    type: 'installing';
    location: string;
    displayLocation: string;
};
export declare const InstallEnvironment: unique symbol;
export interface InstallEnvironment {
    fs: FileSystem;
    platform(): NodeJS.Platform;
    arch(): NodeJS.Architecture;
    homedir(): string;
    versiondir(app: string): string;
    bindir(app: string): string;
    findCmd(cmd: string): Promise<string | undefined>;
}
/**
 * PATH status after installation
 */
export type PathStatus = {
    type: 'in-path';
} | {
    type: 'needs-refresh';
    commands: string[];
} | {
    type: 'needs-setup';
    commands: string[];
};
export interface InstallOptions {
    target?: string;
    /** Replace only the currently running native executable, without changing PATH or other installations. */
    update?: boolean;
    force?: boolean;
    silent?: boolean;
}
/**
 * Result of installation operation
 */
export interface InstallResult {
    success: boolean;
    version?: string;
    location?: string;
    displayLocation?: string;
    pathStatus?: PathStatus;
    error?: string;
}
export declare const InstallService: unique symbol;
export interface InstallService {
    readonly binary: string;
    readonly onProgress: Event<InstallProgressEvent>;
    install(options?: InstallOptions): Promise<InstallResult>;
    currentInstallation(): Promise<Installation>;
}
export type MaybePromise<T> = Promise<T> | T;
export declare const ShellSetup: unique symbol;
export interface ShellSetup {
    readonly name: string;
    exists(env: InstallEnvironment): MaybePromise<boolean>;
    envScript(env: InstallEnvironment, bindir: string): string;
    setup(env: InstallEnvironment, bindir: string): MaybePromise<void>;
}
