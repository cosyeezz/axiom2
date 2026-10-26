import { type AtRestEncryptionBootstrap, type AtRestEncryptionPolicy } from '@genie/at-rest-crypto';
export declare const SIDECAR_READY_SOCKET_ENV = "CODEBUDDY_SIDECAR_READY_SOCKET";
export declare const SIDECAR_READY_TOKEN_ENV = "CODEBUDDY_SIDECAR_READY_TOKEN";
export declare const SIDECAR_READY_SESSION_ID_ENV = "CODEBUDDY_SIDECAR_READY_SESSION_ID";
export declare const SIDECAR_RUNTIME_INSTANCE_ID_ENV = "CODEBUDDY_RUNTIME_INSTANCE_ID";
export declare const SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET_ENV = "CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET";
export declare const WORKBUDDY_AT_REST_ENCRYPTION_ENV = "WORKBUDDY_AT_REST_ENCRYPTION";
export type SidecarReadyConfig = {
    kind: 'disabled';
} | {
    kind: 'invalid';
} | {
    kind: 'ready';
    socketPath: string;
    credentialBootstrapSocketPath: string;
    token: string;
    sessionId: string;
};
export type StartupCredentialProtectionPolicy = AtRestEncryptionPolicy | 'invalid' | undefined;
export type StartupCredentialProtectionMode = 'standalone' | 'prewarm' | 'managed-ready' | 'managed-invalid';
export interface StartupCredentialProtectionDiagnostic {
    eventAtMs: number;
    elapsedMs: number;
    route: 'sidecar-socket' | 'prewarm' | 'standalone';
    policy: AtRestEncryptionPolicy | 'invalid' | 'unset';
    readyConfig: SidecarReadyConfig['kind'];
    cbcPid: number;
    parentPid: number;
    sessionId?: string;
    runtimeInstanceId?: string;
    listenerStartedAtMs?: number;
    connectionAcceptedAtMs?: number;
    payloadReceivedAtMs?: number;
    ackWrittenAtMs?: number;
    receiverOutcome: 'not-applicable' | 'waiting' | 'received' | 'fallback';
    reason?: 'config-incomplete' | 'listener-error' | 'payload-invalid' | 'payload-too-large' | 'policy-mismatch' | 'receiver-timeout' | 'channel-closed' | 'transport-error' | 'capability-missing' | 'runtime-conflict' | 'runtime-not-ready' | 'unknown';
    configured?: boolean;
    runtimeStatus: 'disabled' | 'pending' | 'ready' | 'unavailable';
    runtimeUnavailableCategory?: string;
    wholeFileProtectionReady: boolean;
}
/** Capture and scrub the one-shot sidecar credential synchronously at module startup. */
export declare function consumeSidecarReadyConfig(env: NodeJS.ProcessEnv): SidecarReadyConfig;
export declare function consumeCredentialProtectionPolicy(env: NodeJS.ProcessEnv): StartupCredentialProtectionPolicy;
export declare function classifyStartupCredentialProtectionMode(policy: StartupCredentialProtectionPolicy, readyConfig: SidecarReadyConfig, isPrewarm: boolean): StartupCredentialProtectionMode;
export declare function waitForStartupCredentialProtection(): Promise<boolean>;
export declare function isStartupCredentialProtectionManaged(): boolean;
export declare function getStartupCredentialProtectionMode(): StartupCredentialProtectionMode;
export declare function getStartupCredentialProtectionFailure(): Error | undefined;
/** Returns the current managed-bootstrap outcome without exposing bootstrap material. */
export declare function getStartupCredentialProtectionDiagnostic(): StartupCredentialProtectionDiagnostic;
export declare function configurePrewarmCredentialProtection(payload: unknown): boolean;
export declare function hasRequiredManagedCapabilities(bootstrap: AtRestEncryptionBootstrap): boolean;
export declare function receiveSidecarCredentialProtectionBootstrap(config: Extract<SidecarReadyConfig, {
    kind: 'ready';
}>, expectedPolicy: AtRestEncryptionPolicy, onAccepted?: (bootstrap: AtRestEncryptionBootstrap) => void): Promise<AtRestEncryptionBootstrap>;
export declare function getSidecarRuntimeInstanceId(): string | undefined;
/**
 * Report the kernel-assigned HTTP port to the WorkBuddy backend sidecar.
 *
 * The sidecar injects a one-shot control socket, token, and session id only
 * when it starts a child with `--port 0`. Ordinary CLI invocations have none
 * of these variables, making this function a no-op outside WorkBuddy.
 *
 * The variables are removed before any I/O so the one-shot credential cannot
 * leak into MCP servers or tools spawned later by the CLI process.
 */
export declare function reportSidecarRuntimeReady(endpoint: string, config?: SidecarReadyConfig): Promise<boolean>;
