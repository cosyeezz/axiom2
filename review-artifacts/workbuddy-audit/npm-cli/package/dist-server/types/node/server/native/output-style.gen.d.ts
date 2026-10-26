import { Context, Effect, Layer } from 'effect';
import { OutputStyleManagerImpl } from '../../output-style/output-style-manager';
declare const OutputStyleManagerImplKey_base: Context.ServiceClass<OutputStyleManagerImplKey, "server/native/OutputStyleManagerImpl", OutputStyleManagerImpl>;
export declare class OutputStyleManagerImplKey extends OutputStyleManagerImplKey_base {
}
export declare const OutputStyleManagerImplLayer: Layer.Layer<OutputStyleManagerImplKey, never, never>;
export declare const layer: Layer.Layer<OutputStyleManagerImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof OutputStyleManagerImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, OutputStyleManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
