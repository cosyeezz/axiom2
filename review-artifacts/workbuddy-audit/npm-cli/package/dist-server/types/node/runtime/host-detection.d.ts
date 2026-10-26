/**
 * Host detection — identifies which host launched the agent-cli process.
 *
 * WorkBuddy Desktop injects CODEBUDDY_HOST='workbuddy-desktop' via its
 * sidecar-manager.ts buildCliEnv() function. Other hosts (plain CLI,
 * VSCode ACP, Web UI serve mode) do not set this env var.
 *
 * Use this to gate host-specific behavior such as telemetry events that
 * only make sense for a specific host.
 */
/**
 * Known host identifiers.
 *
 * - `workbuddy-desktop`: launched by WorkBuddy Desktop sidecar-manager
 * - `vscode-acp`: ACP mode (usually IDE integrations like VSCode)
 * - `web-ui`: --serve mode serving the Web UI
 * - `cli`: plain terminal usage (default when nothing else matches)
 */
export type HostName = 'workbuddy-desktop' | 'vscode-acp' | 'web-ui' | 'cli';
/**
 * Get the current host name from the active process state.
 *
 * Prewarm rewrites `process.argv` and merges session env during activation, so
 * this value must not be cached while the process is still in standby.
 */
export declare function getHostName(): HostName;
/**
 * Convenience helper: true when running inside WorkBuddy Desktop.
 */
export declare function isWorkBuddyDesktop(): boolean;
/**
 * Compatibility no-op for tests that used to reset the host cache.
 */
export declare function __resetHostDetectionCache(): void;
