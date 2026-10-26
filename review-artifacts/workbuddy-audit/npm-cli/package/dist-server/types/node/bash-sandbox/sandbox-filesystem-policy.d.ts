import type { SandboxFilesystemConfig } from '@genie/sandbox-cli/sandbox-filesystem-policy';
/** Whether the platform should receive the runtime-wide default write path. */
export declare function shouldIncludeDefaultSandboxAllowWritePath(safeDeleteRuntimeEnabled: boolean | undefined, platform?: NodeJS.Platform): boolean;
export declare function getDefaultSandboxAllowWritePath(platform?: NodeJS.Platform): string;
export declare function getDefaultSandboxFilesystemConfig(safeDeleteRuntimeEnabled: boolean | undefined, platform?: NodeJS.Platform): SandboxFilesystemConfig;
