import { type SandboxShellRuntimeEnvBuildOptions } from '@genie/sandbox-cli/shell-runtime-env';
export type ShellRuntimeEnvBuildOptions = Omit<SandboxShellRuntimeEnvBuildOptions, 'brokerEnabled' | 'brokerRuntimeEnabled' | 'platform' | 'defaultBulkThreshold' | 'safeDeleteEnabled'> & {
    safeDeleteEnabled?: boolean;
    /** Only bulk-check retries may explicitly suppress brokered shell products. */
    brokerRuntimeEnabled?: false;
};
export declare const NONINTERACTIVE_PAGER_ENV: {
    readonly GIT_PAGER: "cat";
    readonly HGPAGER: "cat";
    readonly AWS_PAGER: "";
    readonly SYSTEMD_PAGER: "cat";
    readonly PAGER: "cat";
    readonly MANPAGER: "cat";
    readonly LESSHISTFILE: "-";
};
export declare function buildShellRuntimeEnv(baseEnv?: Record<string, string>, options?: ShellRuntimeEnvBuildOptions): Record<string, string>;
