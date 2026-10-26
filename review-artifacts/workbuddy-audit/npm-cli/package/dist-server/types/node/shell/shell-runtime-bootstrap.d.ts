import { normalizeWindowsCommandForPosixEval, type SandboxShellRuntimePosixCommandOptions } from '@genie/sandbox-cli/shell-runtime-bootstrap';
export type ShellRuntimePosixCommandOptions = Omit<SandboxShellRuntimePosixCommandOptions, 'safeDeleteBootstrap' | 'environmentParts' | 'localeBootstrap'> & {
    onEnvFileReadError?: (envFile: string, error: unknown) => void;
    /** The environment the command starts with; the prepended directories and the env file are read from it. */
    env?: Readonly<Record<string, string | undefined>>;
};
export declare function buildShellRuntimePosixCommand(options: ShellRuntimePosixCommandOptions): string;
export { normalizeWindowsCommandForPosixEval };
