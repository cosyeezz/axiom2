import { Context, Effect, Layer } from 'effect';
import { HookExecutorImpl } from '../../hooks/hook-executor';
import { HookManagerImpl } from '../../hooks/hook-manager';
import { PromptHookServiceImpl } from '../../hooks/prompt-hook-service';
import { ScopedHookRegistryImpl } from '../../hooks/scoped-hook-registry';
declare const HookExecutorImplKey_base: Context.ServiceClass<HookExecutorImplKey, "server/native/HookExecutorImpl", HookExecutorImpl>;
export declare class HookExecutorImplKey extends HookExecutorImplKey_base {
}
export declare const HookExecutorImplLayer: Layer.Layer<HookExecutorImplKey, never, never>;
declare const PromptHookServiceImplKey_base: Context.ServiceClass<PromptHookServiceImplKey, "server/native/PromptHookServiceImpl", PromptHookServiceImpl>;
export declare class PromptHookServiceImplKey extends PromptHookServiceImplKey_base {
}
export declare const PromptHookServiceImplLayer: Layer.Layer<PromptHookServiceImplKey, never, never>;
declare const ScopedHookRegistryImplKey_base: Context.ServiceClass<ScopedHookRegistryImplKey, "server/native/ScopedHookRegistryImpl", ScopedHookRegistryImpl>;
export declare class ScopedHookRegistryImplKey extends ScopedHookRegistryImplKey_base {
}
export declare const ScopedHookRegistryImplLayer: Layer.Layer<ScopedHookRegistryImplKey, never, never>;
declare const HookManagerImplKey_base: Context.ServiceClass<HookManagerImplKey, "server/native/HookManagerImpl", HookManagerImpl>;
export declare class HookManagerImplKey extends HookManagerImplKey_base {
}
export declare const HookManagerImplLayer: Layer.Layer<HookManagerImplKey, never, never>;
export declare const layer: Layer.Layer<HookExecutorImplKey | PromptHookServiceImplKey | ScopedHookRegistryImplKey | HookManagerImplKey, never, never>;
export declare const bridge: ({
    token: unknown;
    program: typeof HookExecutorImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof PromptHookServiceImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof ScopedHookRegistryImplKey;
    mode: "rebind";
} | {
    token: unknown;
    program: typeof HookManagerImplKey;
    mode: "rebind";
})[];
export declare const warmup: Effect.Effect<void, never, HookExecutorImplKey | PromptHookServiceImplKey | ScopedHookRegistryImplKey | HookManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
