import { PermissionMode } from '../../vendor/cbc-shared/node/index.js';
/**
 * Isolated-sandbox full pass (HIGH-RISK).
 *
 * Default `-y` stays `bypassPermissions`: HIGH/CRITICAL commands still prompt.
 * A truthy process env (`1` / `true` / `yes` / `on`) makes `-y` / bypass skip
 * those prompts without changing the visible permission mode.
 *
 * Intentionally an env var, not a CLI flag: full pass can run arbitrary
 * commands (data loss, host damage, credential leak via prompt injection).
 * The launch process must opt in explicitly (industry sandbox design).
 *
 * Process-level only: do not honor `settings.json` `env` (especially project
 * scope) so a repo cannot silently upgrade `-y`.
 * `permissions.disableBypassPermissionsMode` still blocks the bypass path.
 */
export declare const CODEBUDDY_IS_SANDBOX_ENV = "CODEBUDDY_IS_SANDBOX";
export declare function isCodeBuddySandboxEnabled(env?: NodeJS.Dict<string>): boolean;
/**
 * Skip HIGH/CRITICAL safety prompts: explicit `fullAccess`, or bypass while
 * `CODEBUDDY_IS_SANDBOX` is set on the process.
 */
export declare function isUnrestrictedPermissionMode(mode: PermissionMode | string | undefined, env?: NodeJS.Dict<string>): boolean;
/**
 * Session-aware full pass. `permissions.disableBypassPermissionsMode` still
 * blocks the CLI bypass path; ACP `fullAccess` is an explicit IDE mode.
 */
export declare function isUnrestrictedSandboxSession(session: {
    permissionModeSubject?: {
        value?: PermissionMode | string;
    };
    toolPermissionContext?: {
        isBypassPermissionsModeAvailable?: boolean;
    };
}): boolean;
