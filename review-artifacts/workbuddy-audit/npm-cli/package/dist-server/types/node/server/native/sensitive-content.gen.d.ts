import { Context, Effect, Layer } from 'effect';
import { type SandboxCenterIpcClientImpl } from '../../sensitive-content/sandbox-center-ipc-client';
import { type SandboxCenterPortImpl } from '../../sensitive-content/sandbox-center-port';
import { type SensitiveApprovalPortImpl } from '../../sensitive-content/sensitive-approval-port';
import { type SensitiveContentMediationImpl } from '../../sensitive-content/sensitive-content-mediation';
import { type SensitiveDecisionMediationImpl } from '../../sensitive-content/sensitive-decision-mediation';
import { type SensitiveHistoryAdmissionProcessor } from '../../sensitive-content/sensitive-history-admission';
import { type SensitiveModelBoundaryImpl } from '../../sensitive-content/sensitive-model-boundary';
import { type SensitiveToolEgressGuardImpl } from '../../sensitive-content/sensitive-tool-egress-guard';
import { type SensitiveUserInputReviewImpl } from '../../sensitive-content/sensitive-user-input-review';
import { type SettingsSensitiveProtectionPolicy } from '../../sensitive-content/settings-sensitive-protection-policy';
declare const SandboxCenterIpcClientImplKey_base: Context.ServiceClass<SandboxCenterIpcClientImplKey, "server/native/SandboxCenterIpcClientImpl", SandboxCenterIpcClientImpl>;
export declare class SandboxCenterIpcClientImplKey extends SandboxCenterIpcClientImplKey_base {
}
export declare const SandboxCenterIpcClientImplLayer: Layer.Layer<SandboxCenterIpcClientImplKey, never, never>;
declare const SandboxCenterPortImplKey_base: Context.ServiceClass<SandboxCenterPortImplKey, "server/native/SandboxCenterPortImpl", SandboxCenterPortImpl>;
export declare class SandboxCenterPortImplKey extends SandboxCenterPortImplKey_base {
}
export declare const SandboxCenterPortImplLayer: Layer.Layer<SandboxCenterPortImplKey, never, never>;
declare const SensitiveApprovalPortImplKey_base: Context.ServiceClass<SensitiveApprovalPortImplKey, "server/native/SensitiveApprovalPortImpl", SensitiveApprovalPortImpl>;
export declare class SensitiveApprovalPortImplKey extends SensitiveApprovalPortImplKey_base {
}
export declare const SensitiveApprovalPortImplLayer: Layer.Layer<SensitiveApprovalPortImplKey, never, never>;
declare const SensitiveDecisionMediationImplKey_base: Context.ServiceClass<SensitiveDecisionMediationImplKey, "server/native/SensitiveDecisionMediationImpl", SensitiveDecisionMediationImpl>;
export declare class SensitiveDecisionMediationImplKey extends SensitiveDecisionMediationImplKey_base {
}
export declare const SensitiveDecisionMediationImplLayer: Layer.Layer<SensitiveDecisionMediationImplKey, never, never>;
declare const SensitiveContentMediationImplKey_base: Context.ServiceClass<SensitiveContentMediationImplKey, "server/native/SensitiveContentMediationImpl", SensitiveContentMediationImpl>;
export declare class SensitiveContentMediationImplKey extends SensitiveContentMediationImplKey_base {
}
export declare const SensitiveContentMediationImplLayer: Layer.Layer<SensitiveContentMediationImplKey, never, never>;
declare const SensitiveUserInputReviewImplKey_base: Context.ServiceClass<SensitiveUserInputReviewImplKey, "server/native/SensitiveUserInputReviewImpl", SensitiveUserInputReviewImpl>;
export declare class SensitiveUserInputReviewImplKey extends SensitiveUserInputReviewImplKey_base {
}
export declare const SensitiveUserInputReviewImplLayer: Layer.Layer<SensitiveUserInputReviewImplKey, never, never>;
declare const SensitiveHistoryAdmissionProcessorKey_base: Context.ServiceClass<SensitiveHistoryAdmissionProcessorKey, "server/native/SensitiveHistoryAdmissionProcessor", SensitiveHistoryAdmissionProcessor>;
export declare class SensitiveHistoryAdmissionProcessorKey extends SensitiveHistoryAdmissionProcessorKey_base {
}
export declare const SensitiveHistoryAdmissionProcessorLayer: Layer.Layer<SensitiveHistoryAdmissionProcessorKey, never, never>;
declare const SensitiveModelBoundaryImplKey_base: Context.ServiceClass<SensitiveModelBoundaryImplKey, "server/native/SensitiveModelBoundaryImpl", SensitiveModelBoundaryImpl>;
export declare class SensitiveModelBoundaryImplKey extends SensitiveModelBoundaryImplKey_base {
}
export declare const SensitiveModelBoundaryImplLayer: Layer.Layer<SensitiveModelBoundaryImplKey, never, never>;
declare const SensitiveToolEgressGuardImplKey_base: Context.ServiceClass<SensitiveToolEgressGuardImplKey, "server/native/SensitiveToolEgressGuardImpl", SensitiveToolEgressGuardImpl>;
export declare class SensitiveToolEgressGuardImplKey extends SensitiveToolEgressGuardImplKey_base {
}
export declare const SensitiveToolEgressGuardImplLayer: Layer.Layer<SensitiveToolEgressGuardImplKey, never, never>;
declare const SettingsSensitiveProtectionPolicyKey_base: Context.ServiceClass<SettingsSensitiveProtectionPolicyKey, "server/native/SettingsSensitiveProtectionPolicy", SettingsSensitiveProtectionPolicy>;
export declare class SettingsSensitiveProtectionPolicyKey extends SettingsSensitiveProtectionPolicyKey_base {
}
export declare const SettingsSensitiveProtectionPolicyLayer: Layer.Layer<SettingsSensitiveProtectionPolicyKey, never, never>;
export declare const layer: Layer.Layer<SandboxCenterIpcClientImplKey | SandboxCenterPortImplKey | SensitiveApprovalPortImplKey | SensitiveDecisionMediationImplKey | SensitiveContentMediationImplKey | SensitiveUserInputReviewImplKey | SensitiveHistoryAdmissionProcessorKey | SensitiveModelBoundaryImplKey | SensitiveToolEgressGuardImplKey | SettingsSensitiveProtectionPolicyKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof SandboxCenterIpcClientImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxCenterPortImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveApprovalPortImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveDecisionMediationImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveContentMediationImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveUserInputReviewImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveHistoryAdmissionProcessorKey;
    mode: "add";
} | {
    token: unknown;
    program: typeof SensitiveModelBoundaryImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SensitiveToolEgressGuardImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SettingsSensitiveProtectionPolicyKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, SandboxCenterIpcClientImplKey | SandboxCenterPortImplKey | SensitiveApprovalPortImplKey | SensitiveDecisionMediationImplKey | SensitiveContentMediationImplKey | SensitiveUserInputReviewImplKey | SensitiveHistoryAdmissionProcessorKey | SensitiveModelBoundaryImplKey | SensitiveToolEgressGuardImplKey | SettingsSensitiveProtectionPolicyKey>;
export declare const deps: ReadonlyArray<string>;
export {};
