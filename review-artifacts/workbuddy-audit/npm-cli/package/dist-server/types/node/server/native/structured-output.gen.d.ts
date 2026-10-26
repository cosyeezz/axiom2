import { Context, Effect, Layer } from 'effect';
import { type StructuredOutputContextFactoryImpl } from '../../structured-output/structured-output-context';
declare const StructuredOutputContextFactoryImplKey_base: Context.ServiceClass<StructuredOutputContextFactoryImplKey, "server/native/StructuredOutputContextFactoryImpl", StructuredOutputContextFactoryImpl>;
export declare class StructuredOutputContextFactoryImplKey extends StructuredOutputContextFactoryImplKey_base {
}
export declare const StructuredOutputContextFactoryImplLayer: Layer.Layer<StructuredOutputContextFactoryImplKey, never, never>;
export declare const layer: Layer.Layer<StructuredOutputContextFactoryImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof StructuredOutputContextFactoryImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, StructuredOutputContextFactoryImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
