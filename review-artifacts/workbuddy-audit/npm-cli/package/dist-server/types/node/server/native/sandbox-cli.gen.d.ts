import { Context, Effect, Layer } from 'effect';
import { SandboxCLIClientImpl } from '../../sandbox-cli/sandbox-cli-client';
import { SandboxCLILifecycleImpl } from '../../sandbox-cli/sandbox-cli-lifecycle';
import { SandboxCLIProcessManagerImpl } from '../../sandbox-cli/sandbox-cli-process-manager';
import { SandboxRuleSyncServiceImpl } from '../../sandbox-cli/sandbox-rule-sync-service';
import { SandboxShellServiceImpl } from '../../sandbox-cli/sandbox-shell-service';
import { SandboxTurnConfigImpl } from '../../sandbox-cli/sandbox-turn-config';
import { ThreatDomainCheckerImpl } from '../../sandbox-cli/threat-domain-checker';
declare const SandboxCLIClientImplKey_base: Context.ServiceClass<SandboxCLIClientImplKey, "server/native/SandboxCLIClientImpl", SandboxCLIClientImpl>;
export declare class SandboxCLIClientImplKey extends SandboxCLIClientImplKey_base {
}
export declare const SandboxCLIClientImplLayer: Layer.Layer<SandboxCLIClientImplKey, never, never>;
declare const SandboxCLIProcessManagerImplKey_base: Context.ServiceClass<SandboxCLIProcessManagerImplKey, "server/native/SandboxCLIProcessManagerImpl", SandboxCLIProcessManagerImpl>;
export declare class SandboxCLIProcessManagerImplKey extends SandboxCLIProcessManagerImplKey_base {
}
export declare const SandboxCLIProcessManagerImplLayer: Layer.Layer<SandboxCLIProcessManagerImplKey, never, never>;
declare const SandboxCLILifecycleImplKey_base: Context.ServiceClass<SandboxCLILifecycleImplKey, "server/native/SandboxCLILifecycleImpl", SandboxCLILifecycleImpl>;
export declare class SandboxCLILifecycleImplKey extends SandboxCLILifecycleImplKey_base {
}
export declare const SandboxCLILifecycleImplLayer: Layer.Layer<SandboxCLILifecycleImplKey, never, never>;
declare const SandboxRuleSyncServiceImplKey_base: Context.ServiceClass<SandboxRuleSyncServiceImplKey, "server/native/SandboxRuleSyncServiceImpl", SandboxRuleSyncServiceImpl>;
export declare class SandboxRuleSyncServiceImplKey extends SandboxRuleSyncServiceImplKey_base {
}
export declare const SandboxRuleSyncServiceImplLayer: Layer.Layer<SandboxRuleSyncServiceImplKey, never, never>;
declare const SandboxShellServiceImplKey_base: Context.ServiceClass<SandboxShellServiceImplKey, "server/native/SandboxShellServiceImpl", SandboxShellServiceImpl>;
export declare class SandboxShellServiceImplKey extends SandboxShellServiceImplKey_base {
}
export declare const SandboxShellServiceImplLayer: Layer.Layer<SandboxShellServiceImplKey, never, never>;
declare const SandboxTurnConfigImplKey_base: Context.ServiceClass<SandboxTurnConfigImplKey, "server/native/SandboxTurnConfigImpl", SandboxTurnConfigImpl>;
export declare class SandboxTurnConfigImplKey extends SandboxTurnConfigImplKey_base {
}
export declare const SandboxTurnConfigImplLayer: Layer.Layer<SandboxTurnConfigImplKey, never, never>;
declare const ThreatDomainCheckerImplKey_base: Context.ServiceClass<ThreatDomainCheckerImplKey, "server/native/ThreatDomainCheckerImpl", ThreatDomainCheckerImpl>;
export declare class ThreatDomainCheckerImplKey extends ThreatDomainCheckerImplKey_base {
}
export declare const ThreatDomainCheckerImplLayer: Layer.Layer<ThreatDomainCheckerImplKey, never, never>;
export declare const layer: Layer.Layer<SandboxTurnConfigImplKey | SandboxCLIClientImplKey | SandboxCLIProcessManagerImplKey | SandboxCLILifecycleImplKey | SandboxRuleSyncServiceImplKey | SandboxShellServiceImplKey | ThreatDomainCheckerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof SandboxCLIClientImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxCLIProcessManagerImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxCLILifecycleImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxRuleSyncServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxShellServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof SandboxTurnConfigImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ThreatDomainCheckerImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, SandboxTurnConfigImplKey | SandboxCLIClientImplKey | SandboxCLIProcessManagerImplKey | SandboxCLILifecycleImplKey | SandboxRuleSyncServiceImplKey | SandboxShellServiceImplKey | ThreatDomainCheckerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
