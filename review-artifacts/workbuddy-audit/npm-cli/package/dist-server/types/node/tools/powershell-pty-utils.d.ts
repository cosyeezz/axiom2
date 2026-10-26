export declare const WINDOWS_CONPTY_MIN_BUILD = 18309;
export declare const POWERSHELL_USE_PTY_ENV = "CODEBUDDY_POWERSHELL_USE_PTY";
export declare function getWindowsBuildNumber(release?: string): number;
export declare function shouldUsePowerShellConpty(windows: boolean, envValue?: string | undefined, windowsBuildNumber?: number): boolean;
export declare function redactPowerShellCommand(command: string): string;
export declare function wrapPowerShellCommandForExitCode(command: string): string;
export declare function splitCompletePowerShellPtyOutput(input: string): {
    complete: string;
    pending: string;
};
export declare function getPowerShellConptyPathEntries(extraPaths?: string | undefined, envPath?: string | undefined, systemRoot?: string, nvmSymlink?: string | undefined): string[];
export declare function buildPowerShellConptyEnv(baseEnv?: NodeJS.ProcessEnv): Record<string, string | undefined>;
export declare function formatPowerShellConptyCommand(command: string): string;
