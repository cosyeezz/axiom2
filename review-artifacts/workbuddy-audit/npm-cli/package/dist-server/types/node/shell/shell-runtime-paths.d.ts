import { canAccess, canExecute, expandAsarUnpackedCandidates, type SandboxShellRuntimePaths } from '@genie/sandbox-cli/shell-runtime-paths';
export type ShellRuntimePaths = SandboxShellRuntimePaths;
export { canAccess, canExecute, expandAsarUnpackedCandidates, };
export declare function __resetShellRuntimePathsCacheForTest(): void;
export declare function resolveShellRuntimePaths(): ShellRuntimePaths | undefined;
export declare function resolveBrokeredShellRuntimeReadOnlyRoots(runtimePaths?: ShellRuntimePaths | undefined): string[];
