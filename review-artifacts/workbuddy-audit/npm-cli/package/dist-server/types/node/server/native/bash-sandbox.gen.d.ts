import { Context, Effect, Layer } from 'effect';
import { BashSandboxManagerImpl } from '../../bash-sandbox/bash-sandbox-manager';
declare const BashSandboxManagerImplKey_base: Context.ServiceClass<BashSandboxManagerImplKey, "server/native/BashSandboxManagerImpl", BashSandboxManagerImpl>;
export declare class BashSandboxManagerImplKey extends BashSandboxManagerImplKey_base {
}
export declare const BashSandboxManagerImplLayer: Layer.Layer<BashSandboxManagerImplKey, never, never>;
export declare const layer: Layer.Layer<BashSandboxManagerImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof BashSandboxManagerImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, BashSandboxManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
