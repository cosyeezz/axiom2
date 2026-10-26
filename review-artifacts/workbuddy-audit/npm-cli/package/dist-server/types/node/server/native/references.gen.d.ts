import { Context, Effect, Layer } from 'effect';
import { ReferenceServiceImpl } from '../../references/reference-service';
declare const ReferenceServiceImplKey_base: Context.ServiceClass<ReferenceServiceImplKey, "server/native/ReferenceServiceImpl", ReferenceServiceImpl>;
export declare class ReferenceServiceImplKey extends ReferenceServiceImplKey_base {
}
export declare const ReferenceServiceImplLayer: Layer.Layer<ReferenceServiceImplKey, never, never>;
export declare const layer: Layer.Layer<ReferenceServiceImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof ReferenceServiceImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, ReferenceServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
