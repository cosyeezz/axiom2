import { Context, Effect, Layer } from 'effect';
import { AskServiceImpl } from '../../ask/ask-service';
declare const AskServiceImplKey_base: Context.ServiceClass<AskServiceImplKey, "server/native/AskServiceImpl", AskServiceImpl>;
export declare class AskServiceImplKey extends AskServiceImplKey_base {
}
export declare const AskServiceImplLayer: Layer.Layer<AskServiceImplKey, never, never>;
export declare const layer: Layer.Layer<AskServiceImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof AskServiceImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, AskServiceImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
