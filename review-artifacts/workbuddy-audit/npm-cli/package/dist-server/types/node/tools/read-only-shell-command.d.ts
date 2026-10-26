/**
 * 显式传入该 env（`1` / `true`）后，同一轮里的 Bash / PowerShell 调用一律并行执行，
 * 不再按 command 内容推算是否只读。调用方需自行保证各调用互不依赖。
 */
export declare const SHELL_FORCE_PARALLEL_ENV = "CODEBUDDY_BASH_FORCE_PARALLEL";
export declare function isShellForceParallel(): boolean;
export declare function isReadOnlyBashCommand(command: unknown): boolean;
export declare function isReadOnlyPowerShellCommand(command: unknown): boolean;
