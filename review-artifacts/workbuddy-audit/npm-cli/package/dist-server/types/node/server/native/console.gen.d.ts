import { Context, Effect, Layer } from 'effect';
import { ConsoleManagerImpl } from '../../console/console-manager';
declare const ConsoleManagerImplKey_base: Context.ServiceClass<ConsoleManagerImplKey, "server/native/ConsoleManagerImpl", ConsoleManagerImpl>;
export declare class ConsoleManagerImplKey extends ConsoleManagerImplKey_base {
}
export declare const ConsoleManagerImplLayer: Layer.Layer<ConsoleManagerImplKey, never, never>;
export declare const layer: Layer.Layer<ConsoleManagerImplKey, never, never>;
export declare const bridge: {
    token: unknown;
    program: typeof ConsoleManagerImplKey;
    mode: "rebind";
}[];
export declare const warmup: Effect.Effect<void, never, ConsoleManagerImplKey>;
export declare const deps: ReadonlyArray<string>;
export {};
