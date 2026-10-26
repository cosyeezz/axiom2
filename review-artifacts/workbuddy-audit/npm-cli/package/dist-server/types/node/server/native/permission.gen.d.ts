import { Context, Effect, Layer } from 'effect';
import { DirectoryTrustServiceImpl } from '../../permission/directory-trust-service';
import { SandboxAuditServiceImpl } from '../../permission/sandbox-audit-service';
import { SandboxExecPolicyImpl } from '../../permission/sandbox-exec-policy';
import { SandboxOrchestratorImpl } from '../../permission/sandbox-orchestrator';
import { SandboxPermissionGatewayImpl } from '../../permission/sandbox-permission-gateway';
import { SensitiveCommandDetectorImpl } from '../../permission/sensitive-command-detector';
declare const DirectoryTrustServiceImplKey_base: Context.ServiceClass<DirectoryTrustServiceImplKey, "server/native/DirectoryTrustServiceImpl", DirectoryTrustServiceImpl>;
export declare class DirectoryTrustServiceImplKey extends DirectoryTrustServiceImplKey_base {
}
export declare const DirectoryTrustServiceImplLayer: Layer.Layer<DirectoryTrustServiceImplKey, never, never>;
declare const SandboxAuditServiceImplKey_base: Context.ServiceClass<SandboxAuditServiceImplKey, "server/native/SandboxAuditServiceImpl", SandboxAuditServiceImpl>;
export declare class SandboxAuditServiceImplKey extends SandboxAuditServiceImplKey_base {
}
export declare const SandboxAuditServiceImplLayer: Layer.Layer<SandboxAuditServiceImplKey, never, never>;
declare const SandboxExecPolicyImplKey_base: Context.ServiceClass<SandboxExecPolicyImplKey, "server/native/SandboxExecPolicyImpl", SandboxExecPolicyImpl>;
export declare class SandboxExecPolicyImplKey extends SandboxExecPolicyImplKey_base {
}
export declare const SandboxExecPolicyImplLayer: Layer.Layer<SandboxExecPolicyImplKey, never, never>;
declare const SandboxOrchestratorImplKey_base: Context.ServiceClass<SandboxOrchestratorImplKey, "server/native/SandboxOrchestratorImpl", SandboxOrchestratorImpl>;
export declare class SandboxOrchestratorImplKey extends SandboxOrchestratorImplKey_base {
}
export declare const SandboxOrchestratorImplLayer: Layer.Layer<SandboxOrchestratorImplKey, never, never>;
declare const SandboxPermissionGatewayImplKey_base: Context.ServiceClass<SandboxPermissionGatewayImplKey, "server/native/SandboxPermissionGatewayImpl", SandboxPermissionGatewayImpl>;
export declare class SandboxPermissionGatewayImplKey extends SandboxPermissionGatewayImplKey_base {
}
export declare const SandboxPermissionGatewayImplLayer: Layer.Layer<SandboxPermissionGatewayImplKey, never, never>;
declare const SensitiveCommandDetectorImplKey_base: Context.ServiceClass<SensitiveCommandDetectorImplKey, "server/native/SensitiveCommandDetectorImpl", SensitiveCommandDetectorImpl>;
export declare class SensitiveCommandDetectorImplKey extends SensitiveCommandDetectorImplKey_base {
}
export declare const SensitiveCommandDetectorImplLayer: Layer.Layer<SensitiveCommandDetectorImplKey, never, never>;
export declare const layer: Layer.Layer<DirectoryTrustServiceImplKey | SandboxAuditServiceImplKey | SandboxExecPolicyImplKey | SandboxOrchestratorImplKey | SandboxPermissionGatewayImplKey | SensitiveCommandDetectorImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof DirectoryTrustServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxAuditServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxExecPolicyImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxOrchestratorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxPermissionGatewayImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveCommandDetectorImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, DirectoryTrustServiceImplKey | SandboxAuditServiceImplKey | SandboxExecPolicyImplKey | SandboxOrchestratorImplKey | SandboxPermissionGatewayImplKey | SensitiveCommandDetectorImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
